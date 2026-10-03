import type { Db } from './db.ts';
import { tx } from './db.ts';
import {
  DEFAULT_WEIGHTS,
  REMAINING_SHARE,
  type AssignedBy,
  type EmployeeInput,
  type Role,
  type TaskInput,
  type TaskStatus,
  type Weights,
} from './domain.ts';

// ---------- Типы строк БД ----------
export interface EmployeeRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  position: string;
  capacity_hours_week: number;
  available: number;
  speed_factor: number;
  done_count: number;
  on_time_count: number;
}

export interface TaskRow {
  id: number;
  title: string;
  description: string;
  priority: number;
  estimate_hours: number;
  deadline: string | null;
  status: TaskStatus;
  assignee_id: number | null;
  assigned_by: AssignedBy | null;
  assigned_score: number | null;
  created_by: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  actual_hours: number | null;
}

type Params = (string | number | null)[];

export class Repo {
  db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  all<T>(sql: string, ...params: Params): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  get<T>(sql: string, ...params: Params): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  run(sql: string, ...params: Params) {
    return this.db.prepare(sql).run(...params);
  }

  // ---------- Настройки ----------
  getWeights(): Weights {
    const row = this.get<{ value: string }>("SELECT value FROM settings WHERE key = 'weights'");
    if (!row) return { ...DEFAULT_WEIGHTS };
    return { ...DEFAULT_WEIGHTS, ...(JSON.parse(row.value) as Partial<Weights>) };
  }
  setWeights(w: Weights) {
    this.run(
      "INSERT INTO settings(key, value) VALUES('weights', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(w),
    );
  }

  // ---------- Сотрудники ----------
  employeeSkills(employeeId: number): { skillId: number; name: string; level: number }[] {
    return this.all(
      `SELECT es.skill_id AS skillId, s.name AS name, es.level AS level
       FROM employee_skills es JOIN skills s ON s.id = es.skill_id
       WHERE es.employee_id = ? ORDER BY es.level DESC, s.name`,
      employeeId,
    );
  }

  /** Остаток трудоёмкости открытых задач сотрудника, часов. */
  loadHours(employeeId: number): number {
    const rows = this.all<{ status: TaskStatus; estimate_hours: number }>(
      "SELECT status, estimate_hours FROM tasks WHERE assignee_id = ? AND status != 'done'",
      employeeId,
    );
    return rows.reduce((s, r) => s + r.estimate_hours * REMAINING_SHARE[r.status], 0);
  }

  employeeInputs(): EmployeeInput[] {
    const emps = this.all<EmployeeRow>('SELECT * FROM employees ORDER BY id');
    const skillRows = this.all<{ employee_id: number; skill_id: number; level: number }>('SELECT * FROM employee_skills');
    const openTasks = this.all<{ assignee_id: number; status: TaskStatus; estimate_hours: number }>(
      "SELECT assignee_id, status, estimate_hours FROM tasks WHERE assignee_id IS NOT NULL AND status != 'done'",
    );
    return emps.map((e) => {
      const skills = new Map<number, number>();
      for (const s of skillRows) if (s.employee_id === e.id) skills.set(s.skill_id, s.level);
      const loadHours = openTasks
        .filter((t) => t.assignee_id === e.id)
        .reduce((s, t) => s + t.estimate_hours * REMAINING_SHARE[t.status], 0);
      return {
        id: e.id,
        name: e.name,
        capacityHoursWeek: e.capacity_hours_week,
        available: e.available === 1,
        speedFactor: e.speed_factor,
        skills,
        loadHours,
        doneCount: e.done_count,
        onTimeCount: e.on_time_count,
      };
    });
  }

  // ---------- Задачи ----------
  requirements(taskId: number): { skillId: number; name: string; minLevel: number }[] {
    return this.all(
      `SELECT ts.skill_id AS skillId, s.name AS name, ts.min_level AS minLevel
       FROM task_skills ts JOIN skills s ON s.id = ts.skill_id WHERE ts.task_id = ? ORDER BY s.name`,
      taskId,
    );
  }

  taskInput(row: TaskRow): TaskInput {
    return {
      id: row.id,
      priority: row.priority,
      estimateHours: row.estimate_hours,
      deadline: row.deadline ? new Date(`${row.deadline}T23:59:59Z`) : null,
      requirements: this.requirements(row.id).map((r) => ({ skillId: r.skillId, minLevel: r.minLevel })),
    };
  }

  setRequirements(taskId: number, reqs: { skillId: number; minLevel: number }[]) {
    this.run('DELETE FROM task_skills WHERE task_id = ?', taskId);
    for (const r of reqs) {
      this.run('INSERT OR REPLACE INTO task_skills(task_id, skill_id, min_level) VALUES(?,?,?)', taskId, r.skillId, r.minLevel);
    }
  }

  event(taskId: number, actorId: number | null, type: string, details = '') {
    this.run('INSERT INTO task_events(task_id, actor_id, type, details) VALUES(?,?,?,?)', taskId, actorId, type, details);
  }

  /** Назначает задачу сотруднику и фиксирует событие в истории. */
  assign(taskId: number, employeeId: number, by: AssignedBy, score: number | null, actorId: number | null) {
    tx(this.db, () => {
      const cur = this.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', taskId);
      if (!cur) throw new Error('Задача не найдена');
      const status: TaskStatus = cur.status === 'new' ? 'assigned' : cur.status;
      this.run(
        'UPDATE tasks SET assignee_id = ?, assigned_by = ?, assigned_score = ?, status = ? WHERE id = ?',
        employeeId,
        by,
        score,
        status,
        taskId,
      );
      const emp = this.get<{ name: string }>('SELECT name FROM employees WHERE id = ?', employeeId);
      const how = by === 'manual' ? 'вручную' : by === 'auto' ? 'автоматически' : 'пакетно';
      this.event(taskId, actorId, 'assigned', `Исполнитель: ${emp?.name ?? employeeId} (${how}${score != null ? `, оценка ${score.toFixed(1)}` : ''})`);
    });
  }

  /** Меняет статус; при завершении обновляет скорость и надёжность исполнителя. */
  changeStatus(taskId: number, status: TaskStatus, actorId: number | null, actualHours?: number, now: Date = new Date()) {
    tx(this.db, () => {
      const t = this.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', taskId);
      if (!t) throw new Error('Задача не найдена');
      const nowIso = now.toISOString();
      if (status === 'in_progress' && !t.started_at) this.run('UPDATE tasks SET started_at = ? WHERE id = ?', nowIso, taskId);
      if (status === 'done') {
        const hours = actualHours ?? t.estimate_hours;
        this.run('UPDATE tasks SET status = ?, completed_at = ?, actual_hours = ? WHERE id = ?', status, nowIso, hours, taskId);
        if (t.assignee_id != null) this.recordCompletion(t, hours, now);
      } else {
        this.run('UPDATE tasks SET status = ?, completed_at = NULL WHERE id = ?', status, taskId);
      }
      this.event(taskId, actorId, 'status', `Статус: ${t.status} → ${status}`);
    });
  }

  private recordCompletion(t: TaskRow, actualHours: number, now: Date) {
    const emp = this.get<EmployeeRow>('SELECT * FROM employees WHERE id = ?', t.assignee_id!);
    if (!emp) return;
    const ratio = Math.min(2, Math.max(0.5, t.estimate_hours / Math.max(actualHours, 0.1)));
    const speed = 0.8 * emp.speed_factor + 0.2 * ratio;
    const onTime = !t.deadline || now <= new Date(`${t.deadline}T23:59:59Z`) ? 1 : 0;
    this.run(
      'UPDATE employees SET speed_factor = ?, done_count = done_count + 1, on_time_count = on_time_count + ? WHERE id = ?',
      speed,
      onTime,
      emp.id,
    );
  }
}
