import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { hashPassword, verifyPassword } from './auth.ts';
import type { Db } from './db.ts';
import { tx } from './db.ts';
import { TASK_STATUSES, REMAINING_SHARE, type Role, type TaskStatus, type Weights } from './domain.ts';
import { planGreedy, planOptimal } from './engine/assign.ts';
import { rankCandidates } from './engine/scoring.ts';
import { Repo, type EmployeeRow, type TaskRow } from './repo.ts';
import { runSimulation } from './simulate.ts';

interface AuthUser {
  id: number;
  role: Role;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

const here = dirname(fileURLToPath(import.meta.url));

const idParam = z.object({ id: z.coerce.number().int().positive() });
const reqSchema = z.object({ skillId: z.number().int().positive(), minLevel: z.number().int().min(1).max(5) });
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ожидается дата в формате ГГГГ-ММ-ДД');

const taskBody = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().max(5000).default(''),
  priority: z.number().int().min(1).max(4).default(3),
  estimateHours: z.number().positive().max(1000),
  deadline: dateSchema.nullable().optional(),
  requirements: z.array(reqSchema).max(10).default([]),
});

const weightsBody = z.object({
  skill: z.number().min(0).max(1),
  load: z.number().min(0).max(1),
  deadline: z.number().min(0).max(1),
  speed: z.number().min(0).max(1),
  reliability: z.number().min(0).max(1),
});

export interface AppOptions {
  db: Db;
  jwtSecret?: string;
  now?: () => Date;
  logger?: boolean;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  const repo = new Repo(opts.db);
  const now = opts.now ?? (() => new Date());

  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: opts.jwtSecret ?? process.env.JWT_SECRET ?? 'dev-secret-change-me', sign: { expiresIn: '12h' } });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: 'Ошибка валидации', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'Внутренняя ошибка сервера' : err.message });
  });

  // ---------- Авторизация и роли ----------
  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Требуется вход в систему' });
    }
  };
  const requireRole =
    (...roles: Role[]) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      await authenticate(req, reply);
      if (reply.sent) return;
      if (!roles.includes(req.user.role)) return reply.code(403).send({ error: 'Недостаточно прав' });
    };
  const manager = requireRole('admin', 'manager');
  const admin = requireRole('admin');

  // ---------- Сериализация ----------
  const publicEmployee = (e: EmployeeRow) => {
    const load = repo.loadHours(e.id);
    return {
      id: e.id,
      name: e.name,
      email: e.email,
      role: e.role,
      position: e.position,
      capacityHoursWeek: e.capacity_hours_week,
      available: e.available === 1,
      speedFactor: Number(e.speed_factor.toFixed(3)),
      doneCount: e.done_count,
      onTimeCount: e.on_time_count,
      loadHours: Number(load.toFixed(1)),
      loadPct: Number(((load / e.capacity_hours_week) * 100).toFixed(1)),
      skills: repo.employeeSkills(e.id),
    };
  };

  const publicTask = (t: TaskRow, withRequirements = true) => {
    const assignee = t.assignee_id ? repo.get<{ name: string }>('SELECT name FROM employees WHERE id = ?', t.assignee_id) : undefined;
    const today = now().toISOString().slice(0, 10);
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      priority: t.priority,
      estimateHours: t.estimate_hours,
      deadline: t.deadline,
      status: t.status,
      assigneeId: t.assignee_id,
      assigneeName: assignee?.name ?? null,
      assignedBy: t.assigned_by,
      assignedScore: t.assigned_score,
      createdAt: t.created_at,
      startedAt: t.started_at,
      completedAt: t.completed_at,
      actualHours: t.actual_hours,
      overdue: t.status !== 'done' && !!t.deadline && t.deadline < today,
      requirements: withRequirements ? repo.requirements(t.id) : undefined,
    };
  };

  // ---------- Вход ----------
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const emp = repo.get<EmployeeRow>('SELECT * FROM employees WHERE email = ?', body.email.toLowerCase());
    if (!emp || !(await verifyPassword(body.password, emp.password_hash))) {
      return reply.code(401).send({ error: 'Неверный адрес почты или пароль' });
    }
    const token = app.jwt.sign({ id: emp.id, role: emp.role });
    return { token, user: publicEmployee(emp) };
  });

  app.get('/api/me', { preHandler: authenticate }, async (req) => {
    const emp = repo.get<EmployeeRow>('SELECT * FROM employees WHERE id = ?', req.user.id);
    if (!emp) throw Object.assign(new Error('Пользователь не найден'), { statusCode: 401 });
    return publicEmployee(emp);
  });

  // ---------- Навыки ----------
  app.get('/api/skills', { preHandler: authenticate }, async () => repo.all('SELECT id, name, category FROM skills ORDER BY category, name'));

  app.post('/api/skills', { preHandler: manager }, async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(2).max(60), category: z.string().trim().max(60).default('') }).parse(req.body);
    try {
      const r = repo.run('INSERT INTO skills(name, category) VALUES(?,?)', b.name, b.category);
      return reply.code(201).send({ id: Number(r.lastInsertRowid), ...b });
    } catch {
      return reply.code(409).send({ error: 'Навык с таким названием уже существует' });
    }
  });

  // ---------- Сотрудники ----------
  app.get('/api/employees', { preHandler: authenticate }, async () =>
    repo.all<EmployeeRow>('SELECT * FROM employees ORDER BY name').map(publicEmployee),
  );

  app.post('/api/employees', { preHandler: admin }, async (req, reply) => {
    const b = z
      .object({
        name: z.string().trim().min(2).max(120),
        email: z.string().email(),
        password: z.string().min(8).max(100),
        role: z.enum(['admin', 'manager', 'employee']).default('employee'),
        position: z.string().max(120).default(''),
        capacityHoursWeek: z.number().positive().max(80).default(40),
      })
      .parse(req.body);
    if (repo.get('SELECT id FROM employees WHERE email = ?', b.email.toLowerCase())) {
      return reply.code(409).send({ error: 'Пользователь с такой почтой уже существует' });
    }
    const r = repo.run(
      'INSERT INTO employees(name, email, password_hash, role, position, capacity_hours_week) VALUES(?,?,?,?,?,?)',
      b.name,
      b.email.toLowerCase(),
      await hashPassword(b.password),
      b.role,
      b.position,
      b.capacityHoursWeek,
    );
    const row = repo.get<EmployeeRow>('SELECT * FROM employees WHERE id = ?', Number(r.lastInsertRowid))!;
    return reply.code(201).send(publicEmployee(row));
  });

  app.patch('/api/employees/:id', { preHandler: manager }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = z
      .object({
        position: z.string().max(120).optional(),
        capacityHoursWeek: z.number().positive().max(80).optional(),
        available: z.boolean().optional(),
        skills: z.array(z.object({ skillId: z.number().int().positive(), level: z.number().int().min(1).max(5) })).optional(),
      })
      .parse(req.body);
    const cur = repo.get<EmployeeRow>('SELECT * FROM employees WHERE id = ?', id);
    if (!cur) return reply.code(404).send({ error: 'Сотрудник не найден' });
    tx(opts.db, () => {
      if (b.position !== undefined) repo.run('UPDATE employees SET position = ? WHERE id = ?', b.position, id);
      if (b.capacityHoursWeek !== undefined) repo.run('UPDATE employees SET capacity_hours_week = ? WHERE id = ?', b.capacityHoursWeek, id);
      if (b.available !== undefined) repo.run('UPDATE employees SET available = ? WHERE id = ?', b.available ? 1 : 0, id);
      if (b.skills) {
        repo.run('DELETE FROM employee_skills WHERE employee_id = ?', id);
        for (const s of b.skills) repo.run('INSERT INTO employee_skills(employee_id, skill_id, level) VALUES(?,?,?)', id, s.skillId, s.level);
      }
    });
    return publicEmployee(repo.get<EmployeeRow>('SELECT * FROM employees WHERE id = ?', id)!);
  });

  // ---------- Задачи ----------
  app.get('/api/tasks', { preHandler: authenticate }, async (req) => {
    const q = z
      .object({
        status: z.enum(TASK_STATUSES as [TaskStatus, ...TaskStatus[]]).optional(),
        assignee: z.coerce.number().int().optional(),
        unassigned: z.enum(['1', 'true']).optional(),
        q: z.string().optional(),
      })
      .parse(req.query);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.status) (where.push('status = ?'), params.push(q.status));
    if (q.assignee) (where.push('assignee_id = ?'), params.push(q.assignee));
    if (q.unassigned) where.push('assignee_id IS NULL');
    if (q.q) (where.push('(title LIKE ? OR description LIKE ?)'), params.push(`%${q.q}%`, `%${q.q}%`));
    const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY priority, COALESCE(deadline, '9999-12-31'), id`;
    return repo.all<TaskRow>(sql, ...params).map((t) => publicTask(t));
  });

  app.post('/api/tasks', { preHandler: manager }, async (req, reply) => {
    const b = taskBody.parse(req.body);
    const id = tx(opts.db, () => {
      const r = repo.run(
        'INSERT INTO tasks(title, description, priority, estimate_hours, deadline, created_by) VALUES(?,?,?,?,?,?)',
        b.title,
        b.description,
        b.priority,
        b.estimateHours,
        b.deadline ?? null,
        req.user.id,
      );
      const taskId = Number(r.lastInsertRowid);
      repo.setRequirements(taskId, b.requirements);
      repo.event(taskId, req.user.id, 'created', 'Задача создана');
      return taskId;
    });
    return reply.code(201).send(publicTask(repo.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id)!));
  });

  app.get('/api/tasks/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const t = repo.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id);
    if (!t) return reply.code(404).send({ error: 'Задача не найдена' });
    const events = repo.all(
      `SELECT e.id, e.at, e.type, e.details, p.name AS actor
       FROM task_events e LEFT JOIN employees p ON p.id = e.actor_id WHERE e.task_id = ? ORDER BY e.id DESC`,
      id,
    );
    return { ...publicTask(t), events };
  });

  app.patch('/api/tasks/:id', { preHandler: manager }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = taskBody.partial().parse(req.body);
    const t = repo.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id);
    if (!t) return reply.code(404).send({ error: 'Задача не найдена' });
    tx(opts.db, () => {
      repo.run(
        'UPDATE tasks SET title = ?, description = ?, priority = ?, estimate_hours = ?, deadline = ? WHERE id = ?',
        b.title ?? t.title,
        b.description ?? t.description,
        b.priority ?? t.priority,
        b.estimateHours ?? t.estimate_hours,
        b.deadline === undefined ? t.deadline : b.deadline,
        id,
      );
      if (b.requirements) repo.setRequirements(id, b.requirements);
      repo.event(id, req.user.id, 'updated', 'Параметры задачи изменены');
    });
    return publicTask(repo.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id)!);
  });

  app.delete('/api/tasks/:id', { preHandler: manager }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    repo.run('DELETE FROM tasks WHERE id = ?', id);
    return reply.code(204).send();
  });

  app.post('/api/tasks/:id/status', { preHandler: authenticate }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = z
      .object({ status: z.enum(TASK_STATUSES as [TaskStatus, ...TaskStatus[]]), actualHours: z.number().positive().max(2000).optional() })
      .parse(req.body);
    const t = repo.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id);
    if (!t) return reply.code(404).send({ error: 'Задача не найдена' });
    if (req.user.role === 'employee' && t.assignee_id !== req.user.id) {
      return reply.code(403).send({ error: 'Исполнитель может менять статус только своих задач' });
    }
    if (b.status !== 'new' && t.assignee_id == null) {
      return reply.code(409).send({ error: 'Сначала необходимо назначить исполнителя' });
    }
    repo.changeStatus(id, b.status, req.user.id, b.actualHours, now());
    return publicTask(repo.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id)!);
  });

  // ---------- Интеллектуальное распределение ----------
  app.post('/api/tasks/:id/recommend', { preHandler: authenticate }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const t = repo.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id);
    if (!t) return reply.code(404).send({ error: 'Задача не найдена' });
    const weights = repo.getWeights();
    const task = repo.taskInput(t);
    // Текущий исполнитель не должен учитываться в загрузке при пересмотре назначения.
    const emps = repo.employeeInputs().map((e) =>
      e.id === t.assignee_id ? { ...e, loadHours: Math.max(0, e.loadHours - t.estimate_hours * REMAINING_SHARE[t.status]) } : e,
    );
    return { taskId: id, weights, candidates: rankCandidates(task, emps, weights, now()) };
  });

  app.post('/api/tasks/:id/assign', { preHandler: manager }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ employeeId: z.number().int().positive() }).parse(req.body);
    const t = repo.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id);
    if (!t) return reply.code(404).send({ error: 'Задача не найдена' });
    if (!repo.get('SELECT id FROM employees WHERE id = ?', b.employeeId)) return reply.code(404).send({ error: 'Сотрудник не найден' });
    const cand = rankCandidates(repo.taskInput(t), repo.employeeInputs(), repo.getWeights(), now()).find((c) => c.employeeId === b.employeeId);
    repo.assign(id, b.employeeId, 'manual', cand?.feasible ? cand.score : null, req.user.id);
    return publicTask(repo.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id)!);
  });

  app.post('/api/tasks/:id/auto-assign', { preHandler: manager }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const t = repo.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id);
    if (!t) return reply.code(404).send({ error: 'Задача не найдена' });
    const best = rankCandidates(repo.taskInput(t), repo.employeeInputs(), repo.getWeights(), now())[0];
    if (!best || !best.feasible) return reply.code(422).send({ error: 'Нет сотрудников, удовлетворяющих требованиям задачи' });
    repo.assign(id, best.employeeId, 'auto', best.score, req.user.id);
    return { task: publicTask(repo.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id)!), candidate: best };
  });

  app.post('/api/assign/batch', { preHandler: manager }, async (req) => {
    const b = z
      .object({
        taskIds: z.array(z.number().int().positive()).optional(),
        mode: z.enum(['optimal', 'greedy']).default('optimal'),
        apply: z.boolean().default(false),
      })
      .parse(req.body ?? {});
    const rows = b.taskIds?.length
      ? repo.all<TaskRow>(`SELECT * FROM tasks WHERE id IN (${b.taskIds.map(() => '?').join(',')}) AND status = 'new'`, ...b.taskIds)
      : repo.all<TaskRow>("SELECT * FROM tasks WHERE assignee_id IS NULL AND status = 'new'");
    const tasks = rows.map((r) => repo.taskInput(r));
    const weights = repo.getWeights();
    const employees = repo.employeeInputs();
    const started = performance.now();
    const plan = (b.mode === 'optimal' ? planOptimal : planGreedy)(tasks, employees, weights, now());
    const elapsedMs = performance.now() - started;
    if (b.apply) {
      tx(opts.db, () => {
        for (const item of plan) if (item.employeeId != null) repo.assign(item.taskId, item.employeeId, 'batch', item.candidate?.score ?? null, req.user.id);
      });
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items = plan.map((p) => ({
      task: publicTask(byId.get(p.taskId)!),
      employeeId: p.employeeId,
      employeeName: p.employeeId ? (employees.find((e) => e.id === p.employeeId)?.name ?? null) : null,
      candidate: p.candidate,
    }));
    const assigned = items.filter((i) => i.employeeId != null);
    return {
      mode: b.mode,
      applied: b.apply,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      total: items.length,
      assigned: assigned.length,
      unassigned: items.length - assigned.length,
      averageScore: assigned.length ? Number((assigned.reduce((s, i) => s + (i.candidate?.score ?? 0), 0) / assigned.length).toFixed(2)) : 0,
      items,
    };
  });

  // ---------- Настройки весов ----------
  app.get('/api/settings/weights', { preHandler: authenticate }, async () => repo.getWeights());
  app.put('/api/settings/weights', { preHandler: manager }, async (req, reply) => {
    const w = weightsBody.parse(req.body) as Weights;
    const sum = w.skill + w.load + w.deadline + w.speed + w.reliability;
    if (sum <= 0) return reply.code(400).send({ error: 'Сумма весов должна быть положительной' });
    const norm: Weights = {
      skill: w.skill / sum,
      load: w.load / sum,
      deadline: w.deadline / sum,
      speed: w.speed / sum,
      reliability: w.reliability / sum,
    };
    repo.setWeights(norm);
    return norm;
  });

  // ---------- Сводная панель ----------
  app.get('/api/dashboard', { preHandler: authenticate }, async () => {
    const today = now().toISOString().slice(0, 10);
    const byStatus = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const r of repo.all<{ status: TaskStatus; n: number }>('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status')) byStatus[r.status] = r.n;
    const open = TASK_STATUSES.filter((s) => s !== 'done').reduce((s, k) => s + byStatus[k], 0);
    const overdue = repo.get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE status != 'done' AND deadline IS NOT NULL AND deadline < ?", today)!.n;
    const unassigned = repo.get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id IS NULL AND status = 'new'")!.n;
    const done = repo.get<{ n: number; onTime: number | null }>(
      "SELECT COUNT(*) AS n, SUM(CASE WHEN deadline IS NULL OR substr(completed_at,1,10) <= deadline THEN 1 ELSE 0 END) AS onTime FROM tasks WHERE status = 'done'",
    )!;
    const employees = repo.all<EmployeeRow>("SELECT * FROM employees WHERE available = 1 ORDER BY name").map(publicEmployee);
    const pcts = employees.map((e) => e.loadPct);
    const mean = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
    const std = pcts.length ? Math.sqrt(pcts.reduce((a, b) => a + (b - mean) ** 2, 0) / pcts.length) : 0;
    const auto = repo.get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE assigned_by IN ('auto','batch')")!.n;
    const assignedAll = repo.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks WHERE assigned_by IS NOT NULL')!.n;
    return {
      byStatus,
      open,
      overdue,
      unassigned,
      completed: done.n,
      onTimeRate: done.n ? Number(((done.onTime ?? 0) / done.n * 100).toFixed(1)) : null,
      averageLoadPct: Number(mean.toFixed(1)),
      loadStdPct: Number(std.toFixed(1)),
      autoAssignedShare: assignedAll ? Number(((auto / assignedAll) * 100).toFixed(1)) : null,
      workload: employees.map((e) => ({ id: e.id, name: e.name, position: e.position, loadPct: e.loadPct, loadHours: e.loadHours, capacityHoursWeek: e.capacityHoursWeek })),
    };
  });

  // ---------- Имитационный эксперимент ----------
  app.post('/api/simulation', { preHandler: manager }, async (req) => {
    const b = z
      .object({
        seed: z.number().int().default(2025),
        employees: z.number().int().min(3).max(60).default(12),
        tasks: z.number().int().min(5).max(300).default(60),
        runs: z.number().int().min(1).max(50).default(10),
      })
      .parse(req.body ?? {});
    return runSimulation(b);
  });

  app.get('/api/health', async () => ({ status: 'ok', time: now().toISOString() }));

  // ---------- Клиентская часть (собранная) ----------
  const webDist = resolve(here, '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Маршрут не найден' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
