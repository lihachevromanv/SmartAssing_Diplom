import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { LoadBar, Spinner } from '../components/ui.tsx';
import { STATUSES, STATUS_LABELS, type Dashboard as Dash } from '../types.ts';

function Kpi({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'danger' | 'ok' | 'warn' }) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = { new: '#94a3b8', assigned: '#0ea5e9', in_progress: '#4f46e5', review: '#f59e0b', done: '#10b981' };

export default function Dashboard() {
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dash>('/dashboard') });
  if (!data) return <Spinner />;
  const total = STATUSES.reduce((s, k) => s + data.byStatus[k], 0) || 1;

  return (
    <>
      <header className="page-head">
        <h1>Обзор</h1>
        <p className="muted">Состояние очереди задач и загрузки команды</p>
      </header>
      <div className="kpi-grid">
        <Kpi label="Открытых задач" value={data.open} />
        <Kpi label="Ждут назначения" value={data.unassigned} tone={data.unassigned > 0 ? 'warn' : 'ok'} hint="статус «Новая»" />
        <Kpi label="Просрочено" value={data.overdue} tone={data.overdue > 0 ? 'danger' : 'ok'} />
        <Kpi label="Выполнено в срок" value={data.onTimeRate == null ? '—' : `${data.onTimeRate} %`} hint={`завершено задач: ${data.completed}`} />
        <Kpi label="Средняя загрузка" value={`${data.averageLoadPct} %`} hint="остаток работ / недельная ёмкость" />
        <Kpi label="Разброс загрузки" value={`${data.loadStdPct} п. п.`} hint="стандартное отклонение" />
      </div>

      <div className="grid-2">
        <section className="card">
          <h3>Задачи по статусам</h3>
          <div className="stack-bar stack-bar-lg">
            {STATUSES.map((s) => (
              <span key={s} style={{ width: `${(data.byStatus[s] / total) * 100}%`, background: STATUS_COLORS[s] }} title={`${STATUS_LABELS[s]}: ${data.byStatus[s]}`} />
            ))}
          </div>
          <ul className="legend-list">
            {STATUSES.map((s) => (
              <li key={s}>
                <i style={{ background: STATUS_COLORS[s] }} />
                {STATUS_LABELS[s]}
                <strong>{data.byStatus[s]}</strong>
              </li>
            ))}
          </ul>
          {data.autoAssignedShare != null && (
            <p className="muted small">Доля задач, распределённых системой: {data.autoAssignedShare} %</p>
          )}
        </section>

        <section className="card">
          <h3>Загрузка сотрудников</h3>
          <ul className="workload">
            {[...data.workload]
              .sort((a, b) => b.loadPct - a.loadPct)
              .map((w) => (
                <li key={w.id}>
                  <div className="workload-name">
                    <span>{w.name.split(' ').slice(0, 2).join(' ')}</span>
                    <span className="muted small">
                      {w.loadHours} ч · {w.loadPct.toFixed(0)} %
                    </span>
                  </div>
                  <LoadBar pct={w.loadPct} />
                </li>
              ))}
          </ul>
        </section>
      </div>
    </>
  );
}
