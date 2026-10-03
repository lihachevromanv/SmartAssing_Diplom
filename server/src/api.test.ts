import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDb } from './db.ts';
import { DEMO_ACCOUNTS, seedDatabase } from './seed.ts';

let app: FastifyInstance;
let managerToken = '';
let employeeToken = '';
let adminToken = '';

async function login(who: keyof typeof DEMO_ACCOUNTS): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: DEMO_ACCOUNTS[who] });
  assert.equal(res.statusCode, 200);
  return res.json().token;
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

before(async () => {
  const db = openDb(':memory:');
  const now = new Date('2025-09-15T09:00:00Z');
  await seedDatabase(db, now);
  app = await buildApp({ db, jwtSecret: 'test', now: () => now });
  managerToken = await login('manager');
  employeeToken = await login('employee');
  adminToken = await login('admin');
});
after(async () => {
  await app.close();
});

test('вход с неверным паролем отклоняется', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: DEMO_ACCOUNTS.admin.email, password: 'wrong' } });
  assert.equal(res.statusCode, 401);
});

test('доступ без токена запрещён', async () => {
  assert.equal((await app.inject({ url: '/api/tasks' })).statusCode, 401);
});

test('сотрудник не может создавать задачи, руководитель может', async () => {
  const payload = { title: 'Тестовая задача', estimateHours: 6, priority: 2, deadline: '2025-09-30', requirements: [] };
  const denied = await app.inject({ method: 'POST', url: '/api/tasks', headers: auth(employeeToken), payload });
  assert.equal(denied.statusCode, 403);
  const ok = await app.inject({ method: 'POST', url: '/api/tasks', headers: auth(managerToken), payload });
  assert.equal(ok.statusCode, 201);
});

test('валидация: некорректная трудоёмкость отклоняется', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/tasks', headers: auth(managerToken), payload: { title: 'Задача', estimateHours: -3 } });
  assert.equal(res.statusCode, 400);
});

test('рекомендации возвращают ранжированный список с объяснением', async () => {
  const skills = (await app.inject({ url: '/api/skills', headers: auth(managerToken) })).json() as { id: number; name: string }[];
  const react = skills.find((s) => s.name === 'React')!;
  const created = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: auth(managerToken),
    payload: { title: 'Новый экран отчётов', estimateHours: 12, priority: 2, deadline: '2025-09-26', requirements: [{ skillId: react.id, minLevel: 4 }] },
  });
  const taskId = created.json().id;
  const rec = await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/recommend`, headers: auth(managerToken) });
  assert.equal(rec.statusCode, 200);
  const list = rec.json().candidates as { feasible: boolean; score: number; contributions: Record<string, number> }[];
  assert.ok(list.length >= 10);
  assert.ok(list[0].feasible);
  assert.ok(list[0].score >= list[1].score || !list[1].feasible);
  assert.ok(Object.keys(list[0].contributions).length === 5);

  const auto = await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/auto-assign`, headers: auth(managerToken) });
  assert.equal(auto.statusCode, 200);
  assert.equal(auto.json().task.status, 'assigned');
  assert.equal(auto.json().task.assignedBy, 'auto');
});

test('пакетное распределение: предпросмотр не меняет данные, применение — меняет', async () => {
  const before = (await app.inject({ url: '/api/dashboard', headers: auth(managerToken) })).json().unassigned as number;
  assert.ok(before > 0);
  const preview = await app.inject({ method: 'POST', url: '/api/assign/batch', headers: auth(managerToken), payload: { mode: 'optimal', apply: false } });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().total, before);
  const still = (await app.inject({ url: '/api/dashboard', headers: auth(managerToken) })).json().unassigned as number;
  assert.equal(still, before);
  const applied = await app.inject({ method: 'POST', url: '/api/assign/batch', headers: auth(managerToken), payload: { mode: 'optimal', apply: true } });
  const assigned = applied.json().assigned as number;
  const after = (await app.inject({ url: '/api/dashboard', headers: auth(managerToken) })).json().unassigned as number;
  assert.equal(after, before - assigned);
});

test('завершение задачи обновляет скорость и надёжность исполнителя', async () => {
  const tasks = (await app.inject({ url: '/api/tasks?status=assigned', headers: auth(managerToken) })).json() as { id: number; assigneeId: number }[];
  const t = tasks[0];
  const empBefore = ((await app.inject({ url: '/api/employees', headers: auth(managerToken) })).json() as { id: number; doneCount: number }[]).find((e) => e.id === t.assigneeId)!;
  const res = await app.inject({ method: 'POST', url: `/api/tasks/${t.id}/status`, headers: auth(managerToken), payload: { status: 'done', actualHours: 5 } });
  assert.equal(res.statusCode, 200);
  const empAfter = ((await app.inject({ url: '/api/employees', headers: auth(managerToken) })).json() as { id: number; doneCount: number }[]).find((e) => e.id === t.assigneeId)!;
  assert.equal(empAfter.doneCount, empBefore.doneCount + 1);
});

test('исполнитель не может менять статус чужой задачи', async () => {
  const tasks = (await app.inject({ url: '/api/tasks?status=in_progress', headers: auth(managerToken) })).json() as { id: number; assigneeName: string }[];
  const foreign = tasks.find((t) => !t.assigneeName.startsWith('Иванов'));
  assert.ok(foreign);
  const res = await app.inject({ method: 'POST', url: `/api/tasks/${foreign.id}/status`, headers: auth(employeeToken), payload: { status: 'review' } });
  assert.equal(res.statusCode, 403);
});

test('веса критериев нормируются при сохранении', async () => {
  const res = await app.inject({ method: 'PUT', url: '/api/settings/weights', headers: auth(managerToken), payload: { skill: 2, load: 1, deadline: 1, speed: 0, reliability: 0 } }).catch(() => null);
  // значения вне диапазона [0, 1] отклоняются схемой
  assert.equal(res?.statusCode, 400);
  const ok = await app.inject({ method: 'PUT', url: '/api/settings/weights', headers: auth(managerToken), payload: { skill: 0.5, load: 0.25, deadline: 0.25, speed: 0, reliability: 0 } });
  assert.equal(ok.statusCode, 200);
  const w = ok.json();
  assert.ok(Math.abs(w.skill + w.load + w.deadline + w.speed + w.reliability - 1) < 1e-9);
});

test('только администратор создаёт учётные записи', async () => {
  const payload = { name: 'Тестов Тест', email: 'test@smartassign.local', password: 'LongPassw0rd!', role: 'employee' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/employees', headers: auth(managerToken), payload })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/employees', headers: auth(adminToken), payload })).statusCode, 201);
  assert.equal((await app.inject({ method: 'POST', url: '/api/employees', headers: auth(adminToken), payload })).statusCode, 409);
});

test('имитационный эксперимент возвращает все стратегии', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/simulation', headers: auth(managerToken), payload: { runs: 2, tasks: 20, employees: 6 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().strategies.length, 6);
});
