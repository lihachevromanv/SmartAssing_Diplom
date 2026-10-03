export type Role = 'admin' | 'manager' | 'employee';
export type TaskStatus = 'new' | 'assigned' | 'in_progress' | 'review' | 'done';

export interface Skill {
  id: number;
  name: string;
  category: string;
}

export interface Employee {
  id: number;
  name: string;
  email: string;
  role: Role;
  position: string;
  capacityHoursWeek: number;
  available: boolean;
  speedFactor: number;
  doneCount: number;
  onTimeCount: number;
  loadHours: number;
  loadPct: number;
  skills: { skillId: number; name: string; level: number }[];
}

export interface Task {
  id: number;
  title: string;
  description: string;
  priority: number;
  estimateHours: number;
  deadline: string | null;
  status: TaskStatus;
  assigneeId: number | null;
  assigneeName: string | null;
  assignedBy: 'manual' | 'auto' | 'batch' | null;
  assignedScore: number | null;
  createdAt: string;
  completedAt: string | null;
  actualHours: number | null;
  overdue: boolean;
  requirements: { skillId: number; name: string; minLevel: number }[];
}

export interface TaskDetails extends Task {
  events: { id: number; at: string; type: string; details: string; actor: string | null }[];
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
  score: number;
  components: Components;
  contributions: Components;
  adjustedHours: number;
  loadAfterPct: number;
  expectedFinish: string | null;
  deadlineRisk: boolean;
}

export interface Dashboard {
  byStatus: Record<TaskStatus, number>;
  open: number;
  overdue: number;
  unassigned: number;
  completed: number;
  onTimeRate: number | null;
  averageLoadPct: number;
  loadStdPct: number;
  autoAssignedShare: number | null;
  workload: { id: number; name: string; position: string; loadPct: number; loadHours: number; capacityHoursWeek: number }[];
}

export interface BatchPlan {
  mode: 'optimal' | 'greedy';
  applied: boolean;
  elapsedMs: number;
  total: number;
  assigned: number;
  unassigned: number;
  averageScore: number;
  items: { task: Task; employeeId: number | null; employeeName: string | null; candidate: Candidate | null }[];
}

export interface Weights {
  skill: number;
  load: number;
  deadline: number;
  speed: number;
  reliability: number;
}

export interface SimMetrics {
  mismatchRate: number;
  lateRate: number;
  criticalLateRate: number;
  avgLatenessDays: number;
  loadStd: number;
  maxLoad: number;
  makespanDays: number;
  avgSkillMatch: number;
  unassigned: number;
}

export interface SimulationResult {
  params: { seed: number; employees: number; tasks: number; runs: number };
  strategies: { key: string; label: string; metrics: SimMetrics }[];
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  new: 'Новая',
  assigned: 'Назначена',
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Готово',
};
export const STATUSES: TaskStatus[] = ['new', 'assigned', 'in_progress', 'review', 'done'];
export const PRIORITY_LABELS: Record<number, string> = { 1: 'Критический', 2: 'Высокий', 3: 'Обычный', 4: 'Низкий' };
export const CRITERIA_LABELS: Record<keyof Components, string> = {
  skill: 'Навыки',
  load: 'Загрузка',
  deadline: 'Срок',
  speed: 'Скорость',
  reliability: 'Надёжность',
};
export const ROLE_LABELS: Record<Role, string> = { admin: 'Администратор', manager: 'Руководитель', employee: 'Сотрудник' };
