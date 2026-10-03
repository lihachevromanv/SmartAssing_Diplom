export type Role = 'admin' | 'manager' | 'employee';
export type TaskStatus = 'new' | 'assigned' | 'in_progress' | 'review' | 'done';
export type AssignedBy = 'manual' | 'auto' | 'batch';

export const TASK_STATUSES: TaskStatus[] = ['new', 'assigned', 'in_progress', 'review', 'done'];

/** Доля трудоёмкости, оставшаяся к выполнению, в зависимости от статуса задачи. */
export const REMAINING_SHARE: Record<TaskStatus, number> = {
  new: 1,
  assigned: 1,
  in_progress: 0.6,
  review: 0.15,
  done: 0,
};

export interface Requirement {
  skillId: number;
  minLevel: number;
}

export interface Weights {
  skill: number;
  load: number;
  deadline: number;
  speed: number;
  reliability: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  skill: 0.35,
  load: 0.25,
  deadline: 0.2,
  speed: 0.1,
  reliability: 0.1,
};

/** Слепок задачи, достаточный для расчёта оценки. */
export interface TaskInput {
  id: number;
  priority: number; // 1 — критический, 4 — низкий
  estimateHours: number;
  deadline: Date | null;
  requirements: Requirement[];
}

/** Слепок сотрудника на момент расчёта. */
export interface EmployeeInput {
  id: number;
  name: string;
  capacityHoursWeek: number;
  available: boolean;
  speedFactor: number;
  skills: Map<number, number>; // skillId -> level 1..5
  loadHours: number; // остаток трудоёмкости открытых задач
  doneCount: number;
  onTimeCount: number;
}

export interface Components {
  skill: number;
  load: number;
  deadline: number;
  speed: number;
  reliability: number;
}

export interface Candidate {
  employeeId: number;
  name: string;
  feasible: boolean;
  reason?: string;
  score: number; // 0..100
  components: Components;
  contributions: Components; // вклад каждого критерия в итоговую оценку, пункты 0..100
  adjustedHours: number;
  loadBeforeHours: number;
  loadAfterPct: number; // загрузка в процентах от недельной ёмкости
  expectedFinish: string | null;
  deadlineRisk: boolean;
}
