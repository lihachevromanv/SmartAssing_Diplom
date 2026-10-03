import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { useToast } from '../toast.tsx';
import { CRITERIA_LABELS, STATUSES, STATUS_LABELS, type Candidate, type Components, type Task, type TaskDetails, type TaskStatus, type Weights } from '../types.ts';
import { useConfirm } from './Confirm.tsx';
import Field, { normalizeDecimal, parseNumber, sanitizeDecimal, useTouched } from './Field.tsx';
import TaskForm from './TaskForm.tsx';
import { ContributionBar, formatDate, Legend, Modal, PriorityBadge, Spinner, StatusBadge } from './ui.tsx';

export default function TaskDialog({ taskId, onClose }: { taskId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user, isManager } = useAuth();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [finishing, setFinishing] = useState(false);
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

  const remove = useMutation({
    mutationFn: () => api(`/tasks/${taskId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      toast('Задача удалена');
      onClose();
    },
    onError,
  });

  const askRemove = async () => {
    const ok = await confirm({
      title: 'Удалить задачу?',
      message: `Задача «${task?.title}» и вся её история будут удалены без возможности восстановления.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (ok) remove.mutate();
  };

  const changeStatus = (status: TaskStatus) => {
    if (status === 'done') setFinishing(true);
    else setStatus.mutate({ status });
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
      <header className="td-top">
        <h3 className="td-title">{task.title}</h3>
        <div className="row-gap">
          <PriorityBadge p={task.priority} />
          <StatusBadge s={task.status} />
          {task.overdue && <span className="badge badge-danger">Просрочена</span>}
        </div>
        {task.description && <p className="td-desc">{task.description}</p>}
      </header>

      <div className="td-facts">
        <div className="td-fact">
          <span className="td-fact-label">Трудоёмкость</span>
          <span className="td-fact-value">{task.estimateHours} ч</span>
        </div>
        <div className="td-fact">
          <span className="td-fact-label">Срок</span>
          <span className={`td-fact-value ${task.overdue ? 'danger' : ''}`}>{formatDate(task.deadline)}</span>
        </div>
        <div className="td-fact">
          <span className="td-fact-label">Исполнитель</span>
          <span className="td-fact-value">{task.assigneeName ?? 'не назначен'}</span>
        </div>
        <div className="td-fact">
          <span className="td-fact-label">Способ назначения</span>
          <span className="td-fact-value">{task.assignedBy ? { manual: 'вручную', auto: 'автоматически', batch: 'пакетно' }[task.assignedBy] : '—'}</span>
        </div>
      </div>

      <section className="td-block">
        <h4 className="td-label">Требуемые навыки</h4>
        <div className="chips chips-flush">
          {task.requirements.length === 0 && <span className="muted">Специальных требований к навыкам нет</span>}
          {task.requirements.map((r) => (
            <span key={r.skillId} className="chip">
              {r.name} <b>≥ {r.minLevel}</b>
            </span>
          ))}
        </div>
      </section>

      {((canChangeStatus && task.assigneeId) || isManager) && (
        <section className="td-panel">
          {canChangeStatus && task.assigneeId && (
            <div className="td-row">
              <h4 className="td-label">Статус задачи</h4>
              <ol className="stepper">
                {STATUSES.filter((st) => st !== 'new').map((st, i, arr) => {
                  const cur = (arr as TaskStatus[]).indexOf(task.status);
                  const state = i === cur ? 'current' : i < cur ? 'passed' : 'next';
                  return (
                    <li key={st}>
                      <button className={`step step-${state}`} disabled={st === task.status || setStatus.isPending} onClick={() => changeStatus(st)} aria-current={state === 'current'}>
                        <span className="step-num">{state === 'passed' ? '✓' : i + 1}</span>
                        {STATUS_LABELS[st]}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          {isManager && (
            <div className="td-row">
              <h4 className="td-label">Действия с задачей</h4>
              <div className="row-gap">
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                  ✎ Изменить
                </button>
                <button className="btn btn-ghost btn-sm btn-danger-outline" onClick={askRemove} disabled={remove.isPending}>
                  🗑 Удалить
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {task.status !== 'done' && (
        <section className="td-section">
          <div className="section-head">
            <div>
              <h4 className="td-heading">Рекомендации по назначению</h4>
              <p className="td-hint">Чем выше оценка, тем лучше сотрудник подходит для задачи. Цветная полоса показывает вклад критериев.</p>
            </div>
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
                    <tr key={c.employeeId} className={`${c.feasible ? '' : 'row-muted'} ${c.feasible && i === 0 ? 'row-best' : ''} ${c.employeeId === task.assigneeId ? 'row-current' : ''}`}>
                      <td>{c.feasible ? i + 1 : '–'}</td>
                      <td>
                        <span className="cell-title">{c.name}</span>
                        {c.feasible && i === 0 && <span className="badge badge-ok ml">лучший</span>}
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

      <section className="td-section">
        <h4 className="td-heading">История изменений</h4>
        <ol className="history">
          {task.events.map((ev) => (
            <li key={ev.id}>
              <span className="history-dot" aria-hidden />
              <div>
                <div className="history-text">{ev.details}</div>
                <div className="history-meta">
                  {new Date(ev.at.replace(' ', 'T') + (ev.at.includes('T') ? '' : 'Z')).toLocaleString('ru-RU')}
                  {ev.actor && ` · ${ev.actor}`}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>
      {editing && <TaskForm task={task} onClose={() => setEditing(false)} />}
      {finishing && (
        <FinishDialog
          estimate={task.estimateHours}
          pending={setStatus.isPending}
          onClose={() => setFinishing(false)}
          onSubmit={(actualHours) => setStatus.mutate({ status: 'done', actualHours }, { onSuccess: () => setFinishing(false) })}
        />
      )}
    </Modal>
  );
}

/** Окно завершения задачи: ввод фактических трудозатрат с проверкой. */
function FinishDialog({ estimate, pending, onClose, onSubmit }: { estimate: number; pending: boolean; onClose: () => void; onSubmit: (hours: number | undefined) => void }) {
  const [value, setValue] = useState(String(estimate));
  const tc = useTouched();
  const n = parseNumber(value);
  const error =
    value.trim() === ''
      ? 'Укажите фактические трудозатраты в часах'
      : n === null || !/^\d+(,\d{1,2})?$/.test(value.trim())
        ? 'Введите число, например 7,5 (не более двух знаков после запятой)'
        : n <= 0
          ? 'Трудозатраты должны быть больше нуля'
          : n > 2000
            ? 'Значение не может превышать 2000 часов'
            : undefined;
  return (
    <Modal title="Завершение задачи" onClose={onClose} narrow>
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          tc.submit();
          if (error) return;
          onSubmit(n ?? undefined);
        }}
      >
        <p className="confirm-text">Укажите, сколько часов фактически заняла работа. Эти данные уточнят скорость исполнителя. Оценка задачи – {estimate} ч.</p>
        <Field label="Фактические трудозатраты, ч (обязательно)" error={tc.show('hours', error)}>
          <input inputMode="decimal" value={value} onChange={(e) => setValue(sanitizeDecimal(e.target.value))} onBlur={() => (setValue(normalizeDecimal(value)), tc.touch('hours'))} aria-invalid={!!tc.show('hours', error)} autoFocus />
        </Field>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={pending}>
            Завершить задачу
          </button>
        </div>
      </form>
    </Modal>
  );
}
