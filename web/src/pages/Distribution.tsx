import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { ContributionBar, Empty, formatDate, Legend, PriorityBadge } from '../components/ui.tsx';
import { useToast } from '../toast.tsx';
import type { BatchPlan } from '../types.ts';

export default function Distribution() {
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<'optimal' | 'greedy'>('optimal');
  const [plan, setPlan] = useState<BatchPlan | null>(null);

  const build = useMutation({
    mutationFn: () => api<BatchPlan>('/assign/batch', { body: { mode, apply: false } }),
    onSuccess: setPlan,
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const apply = useMutation({
    mutationFn: () => api<BatchPlan>('/assign/batch', { body: { mode, apply: true, taskIds: plan?.items.map((i) => i.task.id) } }),
    onSuccess: (r) => {
      toast(`Назначено задач: ${r.assigned}`);
      setPlan(null);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  return (
    <>
      <header className="page-head">
        <h1>Пакетное распределение</h1>
        <p className="muted">Система строит план назначения всех новых задач; перед применением план можно проверить</p>
      </header>

      <section className="card">
        <div className="mode-row">
          <label className={`mode ${mode === 'optimal' ? 'mode-on' : ''}`}>
            <input type="radio" name="mode" checked={mode === 'optimal'} onChange={() => (setMode('optimal'), setPlan(null))} />
            <div>
              <strong>Оптимальное</strong>
              <span className="small muted">Венгерский алгоритм: максимум суммарной оценки по всем задачам сразу</span>
            </div>
          </label>
          <label className={`mode ${mode === 'greedy' ? 'mode-on' : ''}`}>
            <input type="radio" name="mode" checked={mode === 'greedy'} onChange={() => (setMode('greedy'), setPlan(null))} />
            <div>
              <strong>Последовательное</strong>
              <span className="small muted">Задачи по приоритету и сроку, каждой — лучший кандидат с пересчётом загрузки</span>
            </div>
          </label>
        </div>
        <button className="btn btn-primary" onClick={() => build.mutate()} disabled={build.isPending}>
          Построить план
        </button>
      </section>

      {plan && (
        <section className="section">
          <div className="kpi-grid kpi-grid-4">
            <div className="kpi">
              <div className="kpi-label">Задач в плане</div>
              <div className="kpi-value">{plan.total}</div>
            </div>
            <div className="kpi kpi-ok">
              <div className="kpi-label">Будет назначено</div>
              <div className="kpi-value">{plan.assigned}</div>
            </div>
            <div className={`kpi ${plan.unassigned ? 'kpi-warn' : ''}`}>
              <div className="kpi-label">Без исполнителя</div>
              <div className="kpi-value">{plan.unassigned}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Средняя оценка</div>
              <div className="kpi-value">{plan.averageScore}</div>
              <div className="kpi-hint">расчёт: {plan.elapsedMs} мс</div>
            </div>
          </div>
          {plan.items.length === 0 ? (
            <Empty>Нет новых задач для распределения</Empty>
          ) : (
            <>
              <Legend />
              <div className="table-wrap card-flush">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Задача</th>
                      <th>Приоритет</th>
                      <th>Исполнитель</th>
                      <th>Оценка</th>
                      <th style={{ width: 180 }}>Вклад критериев</th>
                      <th>Готовность</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.items.map((i) => (
                      <tr key={i.task.id}>
                        <td>
                          <div className="cell-title">{i.task.title}</div>
                          <div className="small muted">
                            {i.task.estimateHours} ч · срок {formatDate(i.task.deadline)}
                          </div>
                        </td>
                        <td>
                          <PriorityBadge p={i.task.priority} />
                        </td>
                        <td>{i.employeeName ?? <span className="badge badge-warn">нет подходящих</span>}</td>
                        <td>{i.candidate ? <strong>{i.candidate.score.toFixed(1)}</strong> : '—'}</td>
                        <td>{i.candidate ? <ContributionBar contributions={i.candidate.contributions} /> : '—'}</td>
                        <td>
                          {i.candidate ? formatDate(i.candidate.expectedFinish) : '—'}
                          {i.candidate?.deadlineRisk && <div className="small danger">риск срыва срока</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="form-actions">
                <button className="btn btn-ghost" onClick={() => setPlan(null)}>
                  Отклонить
                </button>
                <button className="btn btn-primary" disabled={apply.isPending || plan.assigned === 0} onClick={() => apply.mutate()}>
                  Применить план ({plan.assigned})
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
