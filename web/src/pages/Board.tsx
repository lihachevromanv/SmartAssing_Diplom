import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import TaskDialog from '../components/TaskDialog.tsx';
import { formatDate, PriorityBadge, Spinner } from '../components/ui.tsx';
import { useToast } from '../toast.tsx';
import { STATUSES, STATUS_LABELS, type Task, type TaskStatus } from '../types.ts';

export default function Board() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['tasks', '', '', false], queryFn: () => api<Task[]>('/tasks') });
  const [openId, setOpenId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);

  const move = useMutation({
    mutationFn: (v: { id: number; status: TaskStatus }) => api(`/tasks/${v.id}/status`, { body: { status: v.status } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  if (!data) return <Spinner />;

  return (
    <>
      <header className="page-head">
        <h1>Доска</h1>
        <p className="muted">Перетаскивайте карточки между колонками, чтобы менять статус</p>
      </header>
      <div className="board">
        {STATUSES.map((s) => {
          const items = data.filter((t) => t.status === s);
          return (
            <section
              key={s}
              className={`column ${over === s ? 'column-over' : ''}`}
              onDragOver={(e) => (e.preventDefault(), setOver(s))}
              onDragLeave={() => setOver(null)}
              onDrop={() => {
                setOver(null);
                const t = data.find((x) => x.id === dragId);
                if (t && t.status !== s) {
                  if (s === 'done' && !window.confirm('Завершить задачу с фактическими трудозатратами, равными оценке?')) return;
                  move.mutate({ id: t.id, status: s });
                }
              }}
            >
              <h3>
                {STATUS_LABELS[s]} <span className="count">{items.length}</span>
              </h3>
              <div className="column-body">
                {items.map((t) => (
                  <article
                    key={t.id}
                    className={`card-task prio-border-${t.priority}`}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => setOpenId(t.id)}
                  >
                    <div className="cell-title">{t.title}</div>
                    <div className="row-gap between">
                      <PriorityBadge p={t.priority} />
                      <span className={t.overdue ? 'danger small' : 'muted small'}>{formatDate(t.deadline)}</span>
                    </div>
                    <div className="small muted">{t.assigneeName ?? 'не назначена'} · {t.estimateHours} ч</div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {openId != null && <TaskDialog taskId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
