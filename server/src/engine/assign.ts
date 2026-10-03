import type { Candidate, EmployeeInput, TaskInput, Weights } from '../domain.ts';
import { hungarian } from './hungarian.ts';
import { adjustedHours, scoreCandidate } from './scoring.ts';

export interface PlanItem {
  taskId: number;
  employeeId: number | null;
  candidate: Candidate | null;
}

/** Стоимость недопустимого назначения (нет требуемых навыков или сотрудник недоступен). */
const FORBIDDEN = 1e6;
const MAX_SLOTS = 8;

/** Порядок обработки: сначала более приоритетные и срочные задачи. */
export function sortTasks(tasks: TaskInput[]): TaskInput[] {
  return [...tasks].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const da = a.deadline?.getTime() ?? Infinity;
    const db = b.deadline?.getTime() ?? Infinity;
    return da - db || a.id - b.id;
  });
}

/** Жадное последовательное распределение: каждой задаче — лучший на данный момент кандидат, затем пересчёт нагрузки. */
export function planGreedy(tasksIn: TaskInput[], employeesIn: EmployeeInput[], weights: Weights, now: Date): PlanItem[] {
  const employees = employeesIn.map((e) => ({ ...e }));
  const plan: PlanItem[] = [];
  for (const task of sortTasks(tasksIn)) {
    let best: Candidate | null = null;
    for (const e of employees) {
      const c = scoreCandidate(task, e, weights, now);
      if (c.feasible && (!best || c.score > best.score)) best = c;
    }
    if (best) {
      const emp = employees.find((e) => e.id === best!.employeeId)!;
      emp.loadHours += best.adjustedHours;
      plan.push({ taskId: task.id, employeeId: emp.id, candidate: best });
    } else {
      plan.push({ taskId: task.id, employeeId: null, candidate: null });
    }
  }
  return plan;
}

/**
 * Оптимальное пакетное распределение как задача о назначениях.
 * Каждый сотрудник представляется набором «слотов»; стоимость k-го слота учитывает нагрузку от k-1 предыдущих задач,
 * поэтому предельные стоимости возрастают и венгерский алгоритм даёт глобальный оптимум по сумме оценок.
 */
export function planOptimal(tasksIn: TaskInput[], employees: EmployeeInput[], weights: Weights, now: Date): PlanItem[] {
  const tasks = sortTasks(tasksIn);
  if (tasks.length === 0) return [];
  const slotsPerEmp = Math.min(MAX_SLOTS, tasks.length);
  const avgHours = tasks.reduce((s, t) => s + t.estimateHours, 0) / tasks.length;

  interface Slot {
    emp: EmployeeInput;
    index: number;
  }
  const slots: Slot[] = [];
  for (const emp of employees) for (let k = 0; k < slotsPerEmp; k++) slots.push({ emp, index: k });

  // Строк не должно быть больше столбцов: при нехватке слотов дополняем фиктивными недопустимыми столбцами.
  const columns = Math.max(slots.length, tasks.length);
  const cache = new Map<string, Candidate>();
  const cost: number[][] = tasks.map((task) => {
    const row: number[] = [];
    for (let j = 0; j < columns; j++) {
      const slot = slots[j];
      if (!slot) {
        row.push(FORBIDDEN);
        continue;
      }
      const c = scoreCandidate(task, slot.emp, weights, now, slot.index * avgHours);
      cache.set(`${task.id}:${j}`, c);
      row.push(c.feasible ? 100 - c.score : FORBIDDEN);
    }
    return row;
  });

  const assignment = hungarian(cost);
  const plan: PlanItem[] = tasks.map((task, i) => {
    const j = assignment[i];
    const slot = slots[j];
    if (!slot || cost[i][j] >= FORBIDDEN) return { taskId: task.id, employeeId: null, candidate: null };
    return { taskId: task.id, employeeId: slot.emp.id, candidate: cache.get(`${task.id}:${j}`) ?? null };
  });

  // Итоговые показатели пересчитываются последовательно, чтобы отразить фактическую нагрузку после назначений.
  const loads = new Map(employees.map((e) => [e.id, e.loadHours]));
  const empById = new Map(employees.map((e) => [e.id, e]));
  return plan.map((item) => {
    if (item.employeeId == null) return item;
    const emp = empById.get(item.employeeId)!;
    const task = tasks.find((t) => t.id === item.taskId)!;
    const load = loads.get(emp.id)!;
    const c = scoreCandidate(task, { ...emp, loadHours: load }, weights, now);
    loads.set(emp.id, load + adjustedHours(task, emp));
    return { ...item, candidate: c };
  });
}
