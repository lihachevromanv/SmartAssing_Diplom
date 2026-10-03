import { useEffect, type ReactNode } from 'react';
import { CRITERIA_LABELS, PRIORITY_LABELS, STATUS_LABELS, type Components, type TaskStatus } from '../types.ts';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export const PriorityBadge = ({ p }: { p: number }) => <span className={`badge prio-${p}`}>{PRIORITY_LABELS[p]}</span>;
export const StatusBadge = ({ s }: { s: TaskStatus }) => <span className={`badge status-${s}`}>{STATUS_LABELS[s]}</span>;

export const CRITERIA_COLORS: Record<keyof Components, string> = {
  skill: '#4f46e5',
  load: '#0ea5e9',
  deadline: '#f59e0b',
  speed: '#10b981',
  reliability: '#a855f7',
};

/** Составная полоса: вклад каждого критерия в итоговую оценку. */
export function ContributionBar({ contributions }: { contributions: Components }) {
  const keys = Object.keys(CRITERIA_LABELS) as (keyof Components)[];
  return (
    <div className="stack-bar" role="img" aria-label={keys.map((k) => `${CRITERIA_LABELS[k]}: ${contributions[k].toFixed(1)}`).join(', ')}>
      {keys.map((k) => (
        <span key={k} style={{ width: `${contributions[k]}%`, background: CRITERIA_COLORS[k] }} title={`${CRITERIA_LABELS[k]}: ${contributions[k].toFixed(1)}`} />
      ))}
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      {(Object.keys(CRITERIA_LABELS) as (keyof Components)[]).map((k) => (
        <span key={k}>
          <i style={{ background: CRITERIA_COLORS[k] }} />
          {CRITERIA_LABELS[k]}
        </span>
      ))}
    </div>
  );
}

export function LoadBar({ pct }: { pct: number }) {
  const cls = pct > 100 ? 'over' : pct > 75 ? 'high' : 'ok';
  return (
    <div className="load-track" title={`${pct.toFixed(0)} %`}>
      <div className={`load-fill ${cls}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export const formatDate = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('ru-RU') : '—');

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Spinner() {
  return <div className="spinner" aria-label="Загрузка" />;
}
