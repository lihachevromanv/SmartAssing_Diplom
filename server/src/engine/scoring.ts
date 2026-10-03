import type { Candidate, Components, EmployeeInput, TaskInput, Weights } from '../domain.ts';
import { addWorkingDays, toIsoDate, workingDaysBetween, WORK_DAYS_PER_WEEK } from './calendar.ts';

/** Горизонт планирования загрузки, недель. */
export const HORIZON_WEEKS = 2;
/** Сглаживание надёжности: вес априорной оценки в «псевдонаблюдениях». */
const PRIOR_WEIGHT = 4;
const PRIOR_ON_TIME = 0.8;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Множители весов критериев в зависимости от приоритета задачи (1 — критический). */
const PRIORITY_MULTIPLIERS: Record<number, Partial<Record<keyof Weights, number>>> = {
  1: { deadline: 1.6, reliability: 1.5, load: 0.6 },
  2: { deadline: 1.25, reliability: 1.2, load: 0.85 },
  3: {},
  4: { load: 1.3, deadline: 0.8 },
};

/** Веса после учёта приоритета и нормировки на единицу. */
export function effectiveWeights(base: Weights, priority: number): Weights {
  const mult = PRIORITY_MULTIPLIERS[priority] ?? {};
  const raw = {
    skill: base.skill * (mult.skill ?? 1),
    load: base.load * (mult.load ?? 1),
    deadline: base.deadline * (mult.deadline ?? 1),
    speed: base.speed * (mult.speed ?? 1),
    reliability: base.reliability * (mult.reliability ?? 1),
  };
  const sum = raw.skill + raw.load + raw.deadline + raw.speed + raw.reliability || 1;
  return {
    skill: raw.skill / sum,
    load: raw.load / sum,
    deadline: raw.deadline / sum,
    speed: raw.speed / sum,
    reliability: raw.reliability / sum,
  };
}

/** Средний уровень владения требуемыми навыками, 0..5. */
export function averageRequiredLevel(task: TaskInput, emp: EmployeeInput): number {
  if (task.requirements.length === 0) return 3;
  let sum = 0;
  for (const r of task.requirements) sum += emp.skills.get(r.skillId) ?? 0;
  return sum / task.requirements.length;
}

/** Коэффициент производительности сотрудника на задаче: скорость × влияние уровня навыков. */
export function performanceFactor(task: TaskInput, emp: EmployeeInput): number {
  return Math.max(0.3, emp.speedFactor * (0.75 + 0.1 * averageRequiredLevel(task, emp)));
}

/** Скорректированная трудоёмкость задачи для конкретного сотрудника, часов. */
export function adjustedHours(task: TaskInput, emp: EmployeeInput): number {
  return task.estimateHours / performanceFactor(task, emp);
}

export function reliability(emp: EmployeeInput): number {
  return (emp.onTimeCount + PRIOR_WEIGHT * PRIOR_ON_TIME) / (emp.doneCount + PRIOR_WEIGHT);
}

export function missingSkills(task: TaskInput, emp: EmployeeInput): number[] {
  return task.requirements.filter((r) => (emp.skills.get(r.skillId) ?? 0) < r.minLevel).map((r) => r.skillId);
}

/**
 * Оценка пригодности сотрудника для задачи.
 * extraLoadHours — виртуальная дополнительная нагрузка (используется при пакетном распределении).
 */
export function scoreCandidate(
  task: TaskInput,
  emp: EmployeeInput,
  weights: Weights,
  now: Date,
  extraLoadHours = 0,
): Candidate {
  const base = {
    employeeId: emp.id,
    name: emp.name,
    adjustedHours: 0,
    loadBeforeHours: emp.loadHours + extraLoadHours,
    loadAfterPct: 0,
    expectedFinish: null as string | null,
    deadlineRisk: false,
  };
  const zero: Components = { skill: 0, load: 0, deadline: 0, speed: 0, reliability: 0 };
  if (!emp.available) {
    return { ...base, feasible: false, reason: 'Сотрудник недоступен', score: 0, components: zero, contributions: zero };
  }
  if (missingSkills(task, emp).length > 0) {
    return {
      ...base,
      feasible: false,
      reason: 'Не выполнены минимальные требования к навыкам',
      score: 0,
      components: zero,
      contributions: zero,
    };
  }

  const hours = adjustedHours(task, emp);
  const loadBefore = emp.loadHours + extraLoadHours;
  const loadAfter = loadBefore + hours;
  const horizon = emp.capacityHoursWeek * HORIZON_WEEKS;
  const dailyCap = emp.capacityHoursWeek / WORK_DAYS_PER_WEEK;

  const skill = task.requirements.length === 0 ? 0.5 : averageRequiredLevel(task, emp) / 5;
  const load = 1 / (1 + (loadAfter / horizon) ** 2);
  const speed = clamp01(emp.speedFactor / 1.5);
  const rel = clamp01(reliability(emp));

  const needDays = loadAfter / dailyCap;
  const finish = addWorkingDays(now, needDays);
  let deadline = 1;
  let risk = false;
  if (task.deadline) {
    const availDays = Math.max(0.5, workingDaysBetween(now, task.deadline) + 1);
    deadline = 1 / (1 + (needDays / availDays) ** 4);
    risk = needDays > availDays;
  }

  const components: Components = { skill, load, deadline, speed, reliability: rel };
  const w = effectiveWeights(weights, task.priority);
  const contributions: Components = {
    skill: 100 * w.skill * skill,
    load: 100 * w.load * load,
    deadline: 100 * w.deadline * deadline,
    speed: 100 * w.speed * speed,
    reliability: 100 * w.reliability * rel,
  };
  const score = contributions.skill + contributions.load + contributions.deadline + contributions.speed + contributions.reliability;

  return {
    ...base,
    feasible: true,
    score,
    components,
    contributions,
    adjustedHours: hours,
    loadAfterPct: (loadAfter / emp.capacityHoursWeek) * 100,
    expectedFinish: toIsoDate(finish),
    deadlineRisk: risk,
  };
}

/** Ранжирует всех сотрудников по убыванию оценки; неподходящие располагаются в конце. */
export function rankCandidates(task: TaskInput, employees: EmployeeInput[], weights: Weights, now: Date): Candidate[] {
  return employees
    .map((e) => scoreCandidate(task, e, weights, now))
    .sort((a, b) => Number(b.feasible) - Number(a.feasible) || b.score - a.score);
}
