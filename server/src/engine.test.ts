import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_WEIGHTS, type EmployeeInput, type TaskInput } from './domain.ts';
import { planGreedy, planOptimal } from './engine/assign.ts';
import { addWorkingDays, workingDaysBetween } from './engine/calendar.ts';
import { hungarian } from './engine/hungarian.ts';
import { effectiveWeights, rankCandidates, scoreCandidate } from './engine/scoring.ts';

const NOW = new Date('2025-09-01T09:00:00Z'); // понедельник

function emp(id: number, skills: [number, number][], over: Partial<EmployeeInput> = {}): EmployeeInput {
  return {
    id,
    name: `E${id}`,
    capacityHoursWeek: 40,
    available: true,
    speedFactor: 1,
    skills: new Map(skills),
    loadHours: 0,
    doneCount: 10,
    onTimeCount: 8,
    ...over,
  };
}
const task = (id: number, reqs: [number, number][], over: Partial<TaskInput> = {}): TaskInput => ({
  id,
  priority: 3,
  estimateHours: 8,
  deadline: new Date('2025-09-12T23:59:59Z'),
  requirements: reqs.map(([skillId, minLevel]) => ({ skillId, minLevel })),
  ...over,
});

test('календарь: рабочие дни пропускают выходные', () => {
  assert.equal(workingDaysBetween(NOW, new Date('2025-09-05T18:00:00Z')), 4);
  assert.equal(workingDaysBetween(NOW, new Date('2025-09-08T18:00:00Z')), 5);
  assert.equal(workingDaysBetween(NOW, NOW), 0);
  assert.equal(addWorkingDays(NOW, 5).toISOString().slice(0, 10), '2025-09-08');
});

test('венгерский алгоритм находит минимум на известном примере', () => {
  const cost = [
    [4, 1, 3],
    [2, 0, 5],
    [3, 2, 2],
  ];
  const res = hungarian(cost);
  const total = res.reduce((s, j, i) => s + cost[i][j], 0);
  assert.equal(total, 5);
  assert.equal(new Set(res).size, 3);
});

test('венгерский алгоритм: прямоугольная матрица даёт оптимум, сверенный перебором', () => {
  const cost = [
    [9, 2, 7, 8],
    [6, 4, 3, 7],
  ];
  const res = hungarian(cost);
  let best = Infinity;
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) best = Math.min(best, cost[0][a] + cost[1][b]);
  assert.equal(res.reduce((s, j, i) => s + cost[i][j], 0), best);
});

test('веса нормируются на единицу при любом приоритете', () => {
  for (const p of [1, 2, 3, 4]) {
    const w = effectiveWeights(DEFAULT_WEIGHTS, p);
    assert.ok(Math.abs(w.skill + w.load + w.deadline + w.speed + w.reliability - 1) < 1e-9);
  }
});

test('жёсткие ограничения: недоступный и неквалифицированный исключаются', () => {
  const t = task(1, [[1, 3]]);
  assert.equal(scoreCandidate(t, emp(1, [[1, 2]]), DEFAULT_WEIGHTS, NOW).feasible, false);
  assert.equal(scoreCandidate(t, emp(2, [[1, 4]], { available: false }), DEFAULT_WEIGHTS, NOW).feasible, false);
  assert.equal(scoreCandidate(t, emp(3, [[1, 3]]), DEFAULT_WEIGHTS, NOW).feasible, true);
});

test('оценка убывает с ростом загрузки при равных навыках', () => {
  const t = task(1, [[1, 3]]);
  const free = scoreCandidate(t, emp(1, [[1, 4]]), DEFAULT_WEIGHTS, NOW);
  const busy = scoreCandidate(t, emp(2, [[1, 4]], { loadHours: 50 }), DEFAULT_WEIGHTS, NOW);
  assert.ok(free.score > busy.score);
});

test('вклады критериев в сумме дают итоговую оценку', () => {
  const c = scoreCandidate(task(1, [[1, 2]]), emp(1, [[1, 4]]), DEFAULT_WEIGHTS, NOW);
  const sum = Object.values(c.contributions).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - c.score) < 1e-9);
  assert.ok(c.score > 0 && c.score <= 100);
});

test('риск срыва срока отмечается при перегруженном исполнителе', () => {
  const t = task(1, [[1, 2]], { deadline: new Date('2025-09-03T23:59:59Z'), estimateHours: 16 });
  const c = scoreCandidate(t, emp(1, [[1, 3]], { loadHours: 40 }), DEFAULT_WEIGHTS, NOW);
  assert.equal(c.deadlineRisk, true);
});

test('ранжирование ставит неподходящих в конец', () => {
  const t = task(1, [[1, 4]]);
  const ranked = rankCandidates(t, [emp(1, [[1, 1]]), emp(2, [[1, 5]]), emp(3, [[1, 4]])], DEFAULT_WEIGHTS, NOW);
  assert.deepEqual(ranked.map((c) => c.feasible), [true, true, false]);
  assert.equal(ranked[0].employeeId, 2);
});

test('пакетное распределение: каждая задача получает допустимого исполнителя, нагрузка распределяется', () => {
  const employees = [emp(1, [[1, 5]]), emp(2, [[1, 5]]), emp(3, [[1, 5]])];
  const tasks = Array.from({ length: 6 }, (_, i) => task(i + 1, [[1, 3]]));
  for (const plan of [planGreedy(tasks, employees, DEFAULT_WEIGHTS, NOW), planOptimal(tasks, employees, DEFAULT_WEIGHTS, NOW)]) {
    assert.equal(plan.length, 6);
    assert.ok(plan.every((p) => p.employeeId != null));
    const counts = [1, 2, 3].map((id) => plan.filter((p) => p.employeeId === id).length);
    assert.deepEqual(counts, [2, 2, 2]);
  }
});

test('задача без подходящих исполнителей остаётся нераспределённой', () => {
  const plan = planOptimal([task(1, [[9, 5]])], [emp(1, [[1, 5]])], DEFAULT_WEIGHTS, NOW);
  assert.equal(plan[0].employeeId, null);
});

test('оптимальное назначение не хуже жадного по суммарной оценке на малом примере', () => {
  const employees = [emp(1, [[1, 5], [2, 5]]), emp(2, [[1, 3]])];
  const tasks = [task(1, [[1, 3]], { priority: 2 }), task(2, [[2, 3]], { priority: 3 })];
  const sum = (plan: ReturnType<typeof planGreedy>) => plan.reduce((s, p) => s + (p.candidate?.score ?? 0), 0);
  const g = sum(planGreedy(tasks, employees, DEFAULT_WEIGHTS, NOW));
  const o = sum(planOptimal(tasks, employees, DEFAULT_WEIGHTS, NOW));
  assert.ok(o >= g - 1e-6);
});
