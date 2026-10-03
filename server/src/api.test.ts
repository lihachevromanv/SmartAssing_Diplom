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
  const payload = { name: 'Тестов Тест Тестович', email: 'test@smartassign.local', password: 'LongPassw0rd!', role: 'employee', position: 'Инженер по тестированию' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/employees', headers: auth(managerToken), payload })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/employees', headers: auth(adminToken), payload })).statusCode, 201);
  assert.equal((await app.inject({ method: 'POST', url: '/api/employees', headers: auth(adminToken), payload })).statusCode, 409);
});

test('имитационный эксперимент возвращает все стратегии', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/simulation', headers: auth(managerToken), payload: { runs: 2, tasks: 20, employees: 6 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().strategies.length, 6);
});

test('карточка сотрудника возвращает навыки и загрузку; неизвестный сотрудник даёт 404', async () => {
  const list = (await app.inject({ url: '/api/employees', headers: auth(managerToken) })).json() as { id: number }[];
  const res = await app.inject({ url: `/api/employees/${list[2].id}`, headers: auth(employeeToken) });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.json().skills));
  assert.equal((await app.inject({ url: '/api/employees/99999', headers: auth(managerToken) })).statusCode, 404);
});

test('изменение задачи: руководитель меняет поля и требования, сотрудник получает 403', async () => {
  const skills = (await app.inject({ url: '/api/skills', headers: auth(managerToken) })).json() as { id: number }[];
  const created = await app.inject({ method: 'POST', url: '/api/tasks', headers: auth(managerToken), payload: { title: 'Исходное название', estimateHours: 4, priority: 3, requirements: [] } });
  const id = created.json().id;
  const denied = await app.inject({ method: 'PATCH', url: `/api/tasks/${id}`, headers: auth(employeeToken), payload: { title: 'Чужое изменение' } });
  assert.equal(denied.statusCode, 403);
  const res = await app.inject({ method: 'PATCH', url: `/api/tasks/${id}`, headers: auth(managerToken), payload: { title: 'Новое название', priority: 1, estimateHours: 9, deadline: '2025-10-20', requirements: [{ skillId: skills[0].id, minLevel: 2 }] } });
  assert.equal(res.statusCode, 200);
  const t = res.json();
  assert.equal(t.title, 'Новое название');
  assert.equal(t.priority, 1);
  assert.equal(t.estimateHours, 9);
  assert.equal(t.requirements.length, 1);
  const cleared = await app.inject({ method: 'PATCH', url: `/api/tasks/${id}`, headers: auth(managerToken), payload: { deadline: null } });
  assert.equal(cleared.json().deadline, null);
});

test('удаление задачи: сотрудник получает 403, руководитель удаляет, затем 404', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/tasks', headers: auth(managerToken), payload: { title: 'Задача на удаление', estimateHours: 2, requirements: [] } });
  const id = created.json().id;
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/tasks/${id}`, headers: auth(employeeToken) })).statusCode, 403);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/tasks/${id}`, headers: auth(managerToken) })).statusCode, 204);
  assert.equal((await app.inject({ url: `/api/tasks/${id}`, headers: auth(managerToken) })).statusCode, 404);
});

test('сообщения об ошибках проверки данных – на русском языке с названиями полей', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/tasks', headers: auth(managerToken), payload: { title: 'ab', estimateHours: -3 } });
  assert.equal(res.statusCode, 400);
  const details = res.json().details as string[];
  assert.ok(details.some((d) => d.startsWith('Название:')), details.join('; '));
  assert.ok(details.some((d) => d.startsWith('Трудоёмкость:')), details.join('; '));
  assert.ok(details.every((d) => !/[a-z]{4,}/.test(d.replace(/^[^:]+:/, ''))), 'сообщения не должны содержать английских слов');
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'не-почта', password: '' } });
  assert.equal(login.statusCode, 400);
  assert.ok(login.json().details.some((d: string) => d.includes('Некорректный адрес электронной почты')));
});

test('поиск задач не зависит от регистра, в том числе для кириллицы, и учитывает исполнителя и навыки', async () => {
  const find = async (q: string) => (await app.inject({ url: `/api/tasks?q=${encodeURIComponent(q)}`, headers: auth(managerToken) })).json() as { title: string }[];
  const lower = await find('исправить ошибку');
  const upper = await find('ИСПРАВИТЬ ОШИБКУ');
  const mixed = await find('ИсПрАвИтЬ');
  assert.ok(lower.length >= 1);
  assert.deepEqual(upper.map((t) => t.title), lower.map((t) => t.title));
  assert.ok(mixed.length >= 1);
  assert.ok((await find('ИВАНОВ')).length >= 1);
  assert.ok((await find('typescript')).length >= 1);
  assert.equal((await find('такого-текста-нет')).length, 0);
});

test('создание сотрудника: ФИО только буквами, три части или две с отметкой «Без отчества», должность обязательна', async () => {
  const base = { email: 'fio@smartassign.local', password: 'LongPassw0rd!', role: 'employee', position: 'Разработчик' };
  const post = (over: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/employees', headers: auth(adminToken), payload: { ...base, ...over } });
  assert.equal((await post({ name: 'Иван' })).statusCode, 400);
  assert.equal((await post({ name: 'Иван Петров3' })).statusCode, 400);
  assert.equal((await post({ name: 'Иван_Петров @' })).statusCode, 400);
  const noPos = await post({ name: 'Иванов Иван Иванович', position: '' });
  assert.equal(noPos.statusCode, 400);
  assert.ok((noPos.json().details as string[]).some((d) => d.startsWith('Должность:')));
  assert.equal((await post({ name: 'Салтыков-Щедрин Михаил Евграфович' })).statusCode, 201);
  // без отчества: нужна отметка, иначе достаточно двух слов нельзя
  const twoWords = await post({ name: 'Иван Петров', email: 'two@smartassign.local' });
  assert.equal(twoWords.statusCode, 400);
  assert.ok((twoWords.json().details as string[]).some((d) => d.includes('Без отчества')));
  assert.equal((await post({ name: 'Иван Петров', email: 'two@smartassign.local', noPatronymic: true })).statusCode, 201);
  assert.equal((await post({ name: 'Иван Петрович Сидоров', email: 'three@smartassign.local', noPatronymic: true })).statusCode, 400);
});

test('проверка остальных форм на сервере: название с буквами, существующая дата, надёжный пароль', async () => {
  const task = (over: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/tasks', headers: auth(managerToken), payload: { title: 'Нормальное название', estimateHours: 5, requirements: [], ...over } });
  const digits = await task({ title: '12345 !!!' });
  assert.equal(digits.statusCode, 400);
  assert.ok((digits.json().details as string[]).some((d) => d.startsWith('Название:')));
  assert.equal((await task({ deadline: '2026-02-31' })).statusCode, 400);
  assert.equal((await task({ deadline: '1999-05-05' })).statusCode, 400);
  assert.equal((await task({ deadline: '2026-12-25' })).statusCode, 201);
  const weak = await app.inject({ method: 'POST', url: '/api/employees', headers: auth(adminToken), payload: { name: 'Новый Сотрудник Тестович', email: 'weak@smartassign.local', password: 'abcdefgh', role: 'employee', position: 'Тестировщик' } });
  assert.equal(weak.statusCode, 400);
  assert.ok((weak.json().details as string[]).some((d) => d.includes('буквы и цифры')));
});

test('ссылки и дубли: несуществующие навыки, повтор навыка, пустая должность и статус «Новая» у назначенной задачи', async () => {
  const task = (requirements: object) => app.inject({ method: 'POST', url: '/api/tasks', headers: auth(managerToken), payload: { title: 'Задача со ссылками', estimateHours: 3, requirements } });
  const unknown = await task([{ skillId: 9999, minLevel: 3 }]);
  assert.equal(unknown.statusCode, 400);
  assert.ok((unknown.json().details as string[]).some((d) => d.includes('несуществующий навык')));
  const dup = await task([{ skillId: 1, minLevel: 3 }, { skillId: 1, minLevel: 4 }]);
  assert.equal(dup.statusCode, 400);
  assert.ok((dup.json().details as string[]).some((d) => d.includes('указан дважды')));
  const emps = (await app.inject({ url: '/api/employees', headers: auth(managerToken) })).json() as { id: number }[];
  const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/employees/${emps[2].id}`, headers: auth(managerToken), payload });
  assert.equal((await patch({ skills: [{ skillId: 9999, level: 3 }] })).statusCode, 400);
  assert.equal((await patch({ skills: [{ skillId: 1, level: 3 }, { skillId: 1, level: 4 }] })).statusCode, 400);
  assert.equal((await patch({ position: '' })).statusCode, 400);
  assert.equal((await patch({ capacityHoursWeek: 0.5 })).statusCode, 400);
  const assigned = ((await app.inject({ url: '/api/tasks?status=assigned', headers: auth(managerToken) })).json() as { id: number }[])[0];
  const back = await app.inject({ method: 'POST', url: `/api/tasks/${assigned.id}/status`, headers: auth(managerToken), payload: { status: 'new' } });
  assert.equal(back.statusCode, 409);
  const longPass = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.ru', password: 'x'.repeat(5000) } });
  assert.equal(longPass.statusCode, 400);
  const skill = await app.inject({ method: 'POST', url: '/api/skills', headers: auth(managerToken), payload: { name: '   ' } });
  assert.equal(skill.statusCode, 400);
  assert.ok((skill.json().details as string[]).some((d) => d.startsWith('Название навыка:')));
});
