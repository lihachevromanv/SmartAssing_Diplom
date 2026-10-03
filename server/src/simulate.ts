import { DEFAULT_WEIGHTS, type EmployeeInput, type TaskInput, type Weights } from './domain.ts';
import { planGreedy, planOptimal, sortTasks } from './engine/assign.ts';
import { workingDaysBetween, WORK_DAYS_PER_WEEK } from './engine/calendar.ts';
import { averageRequiredLevel } from './engine/scoring.ts';

/** Детерминированный генератор псевдослучайных чисел (mulberry32). */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(arr: T[]): T => arr[Math.floor(next() * arr.length)],
    /** Нормальное распределение (преобразование Бокса–Мюллера). */
    normal: () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
  };
}
type Rng = ReturnType<typeof makeRng>;

export const SIM_NOW = new Date('2025-09-01T09:00:00Z'); // понедельник
const SKILL_COUNT = 12;
const MISMATCH_PENALTY = 1.8;

export interface World {
  employees: EmployeeInput[];
  trueSpeed: Map<number, number>;
  tasks: TaskInput[];
}

export function generateWorld(rng: Rng, employeeCount: number, taskCount: number): World {
  const employees: EmployeeInput[] = [];
  const trueSpeed = new Map<number, number>();
  for (let i = 1; i <= employeeCount; i++) {
    const skills = new Map<number, number>();
    const n = rng.int(3, 6);
    while (skills.size < n) skills.set(rng.int(1, SKILL_COUNT), Math.min(5, Math.max(1, Math.round(rng.range(1.5, 5.4)))));
    const speed = Math.min(1.5, Math.max(0.6, 1 + 0.18 * rng.normal()));
    trueSpeed.set(i, speed);
    const done = rng.int(5, 40);
    employees.push({
      id: i,
      name: `Сотрудник ${i}`,
      capacityHoursWeek: rng.next() < 0.15 ? 20 : 40,
      available: true,
      // система знает скорость приблизительно (по истории выполненных задач)
      speedFactor: Math.max(0.5, speed * (1 + 0.05 * rng.normal())),
      skills,
      loadHours: rng.range(0, 12),
      doneCount: done,
      onTimeCount: Math.round(done * Math.min(1, Math.max(0.4, 0.85 + 0.1 * rng.normal()))),
    });
  }

  const tasks: TaskInput[] = [];
  for (let id = 1; id <= taskCount; id++) {
    // требования формируются так, чтобы хотя бы один сотрудник им удовлетворял
    const owner = rng.pick(employees);
    const ownerSkills = [...owner.skills.entries()];
    const reqCount = Math.min(ownerSkills.length, rng.int(1, 3));
    const requirements: TaskInput['requirements'] = [];
    const pool = [...ownerSkills];
    for (let k = 0; k < reqCount; k++) {
      const [skillId, level] = pool.splice(rng.int(0, pool.length - 1), 1)[0];
      requirements.push({ skillId, minLevel: Math.max(1, Math.min(level, rng.int(1, 4))) });
    }
    const roll = rng.next();
    const priority = roll < 0.1 ? 1 : roll < 0.35 ? 2 : roll < 0.8 ? 3 : 4;
    const estimateHours = Math.round(Math.min(60, Math.max(2, Math.exp(rng.range(Math.log(3), Math.log(36))))) * 2) / 2;
    const offsetDays = rng.int(4, 24) + (priority === 1 ? -2 : 0);
    const deadline = new Date(SIM_NOW.getTime() + Math.max(2, offsetDays) * 24 * 3600 * 1000);
    tasks.push({ id, priority, estimateHours, deadline, requirements });
  }
  return { employees, trueSpeed, tasks };
}

export type Strategy = 'random' | 'round_robin' | 'least_loaded' | 'expert_first' | 'smart_greedy' | 'smart_optimal';

export const STRATEGY_LABELS: Record<Strategy, string> = {
  random: 'Случайное',
  round_robin: 'По кругу',
  least_loaded: 'Наименее загруженный',
  expert_first: 'Лучший специалист (ручной подход)',
  smart_greedy: 'Интеллектуальное (последовательное)',
  smart_optimal: 'Интеллектуальное (оптимальное)',
};

const hasSkills = (t: TaskInput, e: EmployeeInput) => t.requirements.every((r) => (e.skills.get(r.skillId) ?? 0) >= r.minLevel);

export function assignWith(
  strategy: Strategy,
  world: World,
  rng: Rng,
  weights: Weights = DEFAULT_WEIGHTS,
): Map<number, number | null> {
  const { employees, tasks } = world;
  const result = new Map<number, number | null>();
  const load = new Map(employees.map((e) => [e.id, e.loadHours]));

  if (strategy === 'smart_greedy' || strategy === 'smart_optimal') {
    const plan = (strategy === 'smart_greedy' ? planGreedy : planOptimal)(tasks, employees, weights, SIM_NOW);
    for (const p of plan) result.set(p.taskId, p.employeeId);
    return result;
  }

  let rr = 0;
  for (const task of sortTasks(tasks)) {
    let chosen: EmployeeInput;
    if (strategy === 'random') chosen = rng.pick(employees);
    else if (strategy === 'round_robin') chosen = employees[rr++ % employees.length];
    else if (strategy === 'least_loaded') chosen = employees.reduce((b, e) => (load.get(e.id)! / e.capacityHoursWeek < load.get(b.id)! / b.capacityHoursWeek ? e : b));
    else {
      // «Лучший специалист»: руководитель поручает задачу самому квалифицированному подходящему сотруднику
      const feasible = employees.filter((e) => hasSkills(task, e));
      const pool = feasible.length ? feasible : employees;
      chosen = pool.reduce((b, e) => (averageRequiredLevel(task, e) > averageRequiredLevel(task, b) ? e : b));
    }
    load.set(chosen.id, load.get(chosen.id)! + task.estimateHours);
    result.set(task.id, chosen.id);
  }
  return result;
}

export interface Metrics {
  mismatchRate: number; // % задач, назначенных без требуемых навыков
  lateRate: number; // % задач, завершённых позже срока
  criticalLateRate: number; // % задач приоритета 1–2, завершённых позже срока
  avgLatenessDays: number; // среднее опоздание по всем задачам, раб. дней
  loadStd: number; // стандартное отклонение загрузки, п. п.
  maxLoad: number; // максимальная загрузка, %
  makespanDays: number; // время завершения всех задач, раб. дней
  avgSkillMatch: number; // средний уровень владения требуемыми навыками, доли от максимума
  unassigned: number;
}

/** Имитация исполнения: сотрудник выполняет назначенные задачи по приоритету и сроку, фактическая трудоёмкость случайна. */
export function evaluate(world: World, assignment: Map<number, number | null>, rng: Rng): Metrics {
  const { employees, tasks, trueSpeed } = world;
  const byEmp = new Map<number, TaskInput[]>(employees.map((e) => [e.id, []]));
  let unassigned = 0;
  for (const t of tasks) {
    const id = assignment.get(t.id);
    if (id == null) unassigned++;
    else byEmp.get(id)!.push(t);
  }
  let mismatches = 0;
  let late = 0;
  let critLate = 0;
  let critTotal = 0;
  let latenessSum = 0;
  let matchSum = 0;
  let assignedCount = 0;
  let makespan = 0;
  const utilization: number[] = [];

  for (const e of employees) {
    const queue = sortTasks(byEmp.get(e.id)!);
    const dailyCap = e.capacityHoursWeek / WORK_DAYS_PER_WEEK;
    let hoursDone = e.loadHours;
    let assignedHours = e.loadHours;
    for (const t of queue) {
      const ok = hasSkills(t, e);
      if (!ok) mismatches++;
      const lvl = averageRequiredLevel(t, e);
      matchSum += lvl / 5;
      assignedCount++;
      const perf = (trueSpeed.get(e.id) ?? 1) * (0.75 + 0.1 * lvl);
      const noise = Math.exp(0.2 * rng.normal());
      const actual = (t.estimateHours / Math.max(0.3, perf)) * (ok ? 1 : MISMATCH_PENALTY) * noise;
      hoursDone += actual;
      assignedHours += t.estimateHours;
      const finishDays = hoursDone / dailyCap;
      makespan = Math.max(makespan, finishDays);
      const dueDays = t.deadline ? workingDaysBetween(SIM_NOW, t.deadline) + 1 : Infinity;
      const isCrit = t.priority <= 2;
      if (isCrit) critTotal++;
      if (finishDays > dueDays) {
        late++;
        latenessSum += finishDays - dueDays;
        if (isCrit) critLate++;
      }
    }
    utilization.push((assignedHours / (e.capacityHoursWeek * 2)) * 100);
  }
  const mean = utilization.reduce((a, b) => a + b, 0) / utilization.length;
  const std = Math.sqrt(utilization.reduce((a, b) => a + (b - mean) ** 2, 0) / utilization.length);
  const total = Math.max(1, assignedCount);
  return {
    mismatchRate: (mismatches / total) * 100,
    lateRate: (late / total) * 100,
    criticalLateRate: critTotal ? (critLate / critTotal) * 100 : 0,
    avgLatenessDays: latenessSum / total,
    loadStd: std,
    maxLoad: Math.max(...utilization),
    makespanDays: makespan,
    avgSkillMatch: matchSum / total,
    unassigned,
  };
}

export interface SimulationParams {
  seed: number;
  employees: number;
  tasks: number;
  runs: number;
}

export interface SimulationResult {
  params: SimulationParams;
  strategies: { key: Strategy; label: string; metrics: Metrics }[];
}

const STRATEGIES: Strategy[] = ['random', 'round_robin', 'least_loaded', 'expert_first', 'smart_greedy', 'smart_optimal'];

export function runSimulation(params: SimulationParams, weights: Weights = DEFAULT_WEIGHTS): SimulationResult {
  const sums = new Map<Strategy, Metrics>();
  for (let run = 0; run < params.runs; run++) {
    const seed = params.seed + run * 7919;
    for (const s of STRATEGIES) {
      // для каждой стратегии используется один и тот же мир и одинаковый поток случайных чисел исполнения
      const world = generateWorld(makeRng(seed), params.employees, params.tasks);
      const assignment = assignWith(s, world, makeRng(seed + 1), weights);
      const m = evaluate(world, assignment, makeRng(seed + 2));
      const acc = sums.get(s);
      if (!acc) sums.set(s, { ...m });
      else for (const k of Object.keys(m) as (keyof Metrics)[]) acc[k] += m[k];
    }
  }
  return {
    params,
    strategies: STRATEGIES.map((key) => {
      const m = sums.get(key)!;
      const avg = Object.fromEntries((Object.keys(m) as (keyof Metrics)[]).map((k) => [k, Number((m[k] / params.runs).toFixed(2))])) as unknown as Metrics;
      return { key, label: STRATEGY_LABELS[key], metrics: avg };
    }),
  };
}
