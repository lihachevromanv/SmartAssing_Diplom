import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { useToast } from '../toast.tsx';
import { CRITERIA_LABELS, STATUSES, STATUS_LABELS, type Candidate, type Components, type Task, type TaskDetails, type TaskStatus, type Weights } from '../types.ts';
import { ContributionBar, formatDate, Legend, Modal, PriorityBadge, Spinner, StatusBadge } from './ui.tsx';

export default function TaskDialog({ taskId, onClose }: { taskId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user, isManager } = useAuth();
  const { data: task } = useQuery({ queryKey: ['task', taskId], queryFn: () => api<TaskDetails>(`/tasks/${taskId}`) });
  const { data: rec, isFetching: recLoading } = useQuery({
    queryKey: ['recommend', taskId, task?.assigneeId, task?.status],
    queryFn: () => api<{ weights: Weights; candidates: Candidate[] }>(`/tasks/${taskId}/recommend`, { body: {} }),
    enabled: !!task && task.status !== 'done',
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['task', taskId] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['employees'] });
    qc.invalidateQueries({ queryKey: ['recommend', taskId] });
  };
  const onError = (e: Error) => toast(e.message, 'error');

  const assign = useMutation({
    mutationFn: (employeeId: number) => api<Task>(`/tasks/${taskId}/assign`, { body: { employeeId } }),
    onSuccess: () => (refresh(), toast('Исполнитель назначен')),
    onError,
  });
  const auto = useMutation({
    mutationFn: () => api(`/tasks/${taskId}/auto-assign`, { body: {} }),
    onSuccess: () => (refresh(), toast('Назначен лучший кандидат')),
    onError,
  });
  const setStatus = useMutation({
    mutationFn: (v: { status: TaskStatus; actualHours?: number }) => api<Task>(`/tasks/${taskId}/status`, { body: v }),
    onSuccess: () => (refresh(), toast('Статус обновлён')),
    onError,
  });

  const changeStatus = (status: TaskStatus) => {
    if (status === 'done') {
      const input = window.prompt('Фактические трудозатраты, ч (пусто — по оценке):', String(task?.estimateHours ?? ''));
      if (input === null) return;
      const n = Number(input.replace(',', '.'));
      setStatus.mutate({ status, actualHours: input.trim() && n > 0 ? n : undefined });
    } else setStatus.mutate({ status });
  };

  if (!task) {
    return (
      <Modal title="Задача" onClose={onClose}>
        <Spinner />
      </Modal>
    );
  }

  const canChangeStatus = isManager || task.assigneeId === user?.id;
  const keys = Object.keys(CRITERIA_LABELS) as (keyof Components)[];

  return (
    <Modal title={`Задача №${task.id}`} onClose={onClose} wide>
      <div className="task-head">
        <h3>{task.title}</h3>
        <div className="row-gap">
          <PriorityBadge p={task.priority} />
          <StatusBadge s={task.status} />
          {task.overdue && <span className="badge badge-danger">Просрочена</span>}
        </div>
        {task.description && <p className="muted">{task.description}</p>}
        <dl className="facts">
          <div>
            <dt>Трудоёмкость</dt>
            <dd>{task.estimateHours} ч</dd>
          </div>
          <div>
            <dt>Срок</dt>
            <dd>{formatDate(task.deadline)}</dd>
          </div>
          <div>
            <dt>Исполнитель</dt>
            <dd>{task.assigneeName ?? 'не назначен'}</dd>
          </div>
          <div>
            <dt>Способ назначения</dt>
            <dd>{task.assignedBy ? { manual: 'вручную', auto: 'автоматически', batch: 'пакетно' }[task.assignedBy] : '—'}</dd>
          </div>
        </dl>
        <div className="chips">
          {task.requirements.length === 0 && <span className="muted">Специальных требований к навыкам нет</span>}
          {task.requirements.map((r) => (
            <span key={r.skillId} className="chip">
              {r.name} ≥ {r.minLevel}
            </span>
          ))}
        </div>
        {canChangeStatus && task.assigneeId && (
          <div className="status-actions">
            {STATUSES.filter((s) => s !== 'new').map((s) => (
              <button key={s} className={`btn btn-sm ${task.status === s ? 'btn-primary' : 'btn-ghost'}`} disabled={task.status === s || setStatus.isPending} onClick={() => changeStatus(s)}>
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        )}
      </div>

      {task.status !== 'done' && (
        <section className="section">
          <div className="section-head">
            <h3>Рекомендации по назначению</h3>
            {isManager && (
              <button className="btn btn-primary btn-sm" onClick={() => auto.mutate()} disabled={auto.isPending}>
                Назначить лучшего
              </button>
            )}
          </div>
          <Legend />
          {recLoading && !rec ? (
            <Spinner />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Сотрудник</th>
                    <th>Оценка</th>
                    <th style={{ width: 200 }}>Вклад критериев</th>
                    <th>Время, ч</th>
                    <th>Загрузка</th>
                    <th>Готовность</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rec?.candidates.map((c, i) => (
                    <tr key={c.employeeId} className={c.feasible ? '' : 'row-muted'}>
                      <td>{c.feasible ? i + 1 : '–'}</td>
                      <td>
                        {c.name}
                        {c.employeeId === task.assigneeId && <span className="badge badge-info ml">текущий</span>}
                        {!c.feasible && <div className="small">{c.reason}</div>}
                      </td>
                      <td>{c.feasible ? <strong>{c.score.toFixed(1)}</strong> : '—'}</td>
                      <td>
                        {c.feasible ? (
                          <>
                            <ContributionBar contributions={c.contributions} />
                            <div className="small" title={keys.map((k) => `${CRITERIA_LABELS[k]} ${(c.components[k] * 100).toFixed(0)}%`).join(' · ')}>
                              нав. {(c.components.skill * 100).toFixed(0)}% · загр. {(c.components.load * 100).toFixed(0)}%
                            </div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{c.feasible ? c.adjustedHours.toFixed(1) : '—'}</td>
                      <td>{c.feasible ? `${c.loadAfterPct.toFixed(0)} %` : '—'}</td>
                      <td>
                        {c.feasible ? formatDate(c.expectedFinish) : '—'}
                        {c.deadlineRisk && <div className="small danger">риск срыва срока</div>}
                      </td>
                      <td>
                        {isManager && c.employeeId !== task.assigneeId && (
                          <button className="btn btn-ghost btn-sm" disabled={assign.isPending} onClick={() => assign.mutate(c.employeeId)}>
                            Назначить
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="section">
        <h3>История</h3>
        <ul className="timeline">
          {task.events.map((ev) => (
            <li key={ev.id}>
              <time>{new Date(ev.at.replace(' ', 'T') + (ev.at.includes('T') ? '' : 'Z')).toLocaleString('ru-RU')}</time>
              <span>
                {ev.details} {ev.actor && <em className="muted">— {ev.actor}</em>}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Modal>
  );
}
