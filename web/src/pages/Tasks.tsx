import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { useAuth } from '../auth.tsx';
import TaskDialog from '../components/TaskDialog.tsx';
import TaskForm from '../components/TaskForm.tsx';
import { Empty, formatDate, PriorityBadge, Spinner, StatusBadge } from '../components/ui.tsx';
import { STATUSES, STATUS_LABELS, type Task } from '../types.ts';

export default function Tasks() {
  const { isManager, user } = useAuth();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  if (mine && user) params.set('assignee', String(user.id));
  const { data, isLoading } = useQuery({ queryKey: ['tasks', status, q, mine], queryFn: () => api<Task[]>(`/tasks?${params}`) });

  return (
    <>
      <header className="page-head page-head-row">
        <div>
          <h1>Задачи</h1>
          <p className="muted">Все задачи с параметрами и исполнителями</p>
        </div>
        {isManager && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            + Новая задача
          </button>
        )}
      </header>

      <div className="toolbar">
        <input type="search" placeholder="Поиск по названию…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус">
          <option value="">Все статусы</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <label className="inline">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Только мои
        </label>
      </div>

      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <Empty>Задачи не найдены</Empty>
      ) : (
        <div className="table-wrap card-flush">
          <table className="table table-hover">
            <thead>
              <tr>
                <th>Задача</th>
                <th>Приоритет</th>
                <th>Статус</th>
                <th>Исполнитель</th>
                <th>Срок</th>
                <th>Часы</th>
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id} onClick={() => setOpenId(t.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(t.id)}>
                  <td>
                    <div className="cell-title">{t.title}</div>
                    <div className="chips chips-sm">
                      {t.requirements.map((r) => (
                        <span key={r.skillId} className="chip chip-sm">
                          {r.name} ≥ {r.minLevel}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <PriorityBadge p={t.priority} />
                  </td>
                  <td>
                    <StatusBadge s={t.status} />
                  </td>
                  <td>{t.assigneeName ?? <span className="muted">—</span>}</td>
                  <td className={t.overdue ? 'danger' : ''}>{formatDate(t.deadline)}</td>
                  <td>{t.estimateHours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId != null && <TaskDialog taskId={openId} onClose={() => setOpenId(null)} />}
      {creating && <TaskForm onClose={() => setCreating(false)} />}
    </>
  );
}
