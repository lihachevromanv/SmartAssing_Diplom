import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = resolve(here, '../data/smartassign.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','employee')),
  position TEXT NOT NULL DEFAULT '',
  capacity_hours_week REAL NOT NULL DEFAULT 40 CHECK (capacity_hours_week > 0),
  available INTEGER NOT NULL DEFAULT 1,
  speed_factor REAL NOT NULL DEFAULT 1.0,
  done_count INTEGER NOT NULL DEFAULT 0,
  on_time_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS employee_skills (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
  PRIMARY KEY (employee_id, skill_id)
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 4),
  estimate_hours REAL NOT NULL CHECK (estimate_hours > 0),
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','assigned','in_progress','review','done')),
  assignee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  assigned_by TEXT CHECK (assigned_by IN ('manual','auto','batch')),
  assigned_score REAL,
  created_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  actual_hours REAL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE TABLE IF NOT EXISTS task_skills (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  min_level INTEGER NOT NULL CHECK (min_level BETWEEN 1 AND 5),
  PRIMARY KEY (task_id, skill_id)
);
CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  actor_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export type Db = DatabaseSync;

export function openDb(path: string = process.env.DB_PATH ?? DEFAULT_DB_PATH): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

const depths = new WeakMap<Db, number>();

/** Выполняет функцию в транзакции (вложенные вызовы используют точки сохранения); при исключении изменения откатываются. */
export function tx<T>(db: Db, fn: () => T): T {
  const depth = depths.get(db) ?? 0;
  const name = `sp_${depth}`;
  db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
  depths.set(db, depth + 1);
  try {
    const result = fn();
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return result;
  } catch (e) {
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    throw e;
  } finally {
    depths.set(db, depth);
  }
}
