import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { useConfirm } from '../components/Confirm.tsx';
import TaskDialog from '../components/TaskDialog.tsx';
import { formatDate, PriorityBadge, Spinner } from '../components/ui.tsx';
import { useToast } from '../toast.tsx';
import { STATUSES, STATUS_LABELS, type Candidate, type Task, type TaskStatus } from '../types.ts';

export default function Board() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { user, isManager } = useAuth();
  const { data } = useQuery({ queryKey: ['tasks', '', '', false], queryFn: () => api<Task[]>('/tasks') });
  const [openId, setOpenId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['task'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['employees'] });
  };

  const move = useMutation({
    mutationFn: (v: { id: number; status: TaskStatus; autoAssign?: boolean }) =>
      (v.autoAssign ? api<{ candidate: Candidate }>(`/tasks/${v.id}/auto-assign`, { body: {} }) : Promise.resolve(null)).then(() =>
        api(`/tasks/${v.id}/status`, { body: { status: v.status } }),
      ),
    onSuccess: refresh,
    onError: (e: Error) => (toast(e.message, 'error'), refresh()),
  });

  const canMove = (t: Task) => isManager || t.assigneeId === user?.id;

  const drop = async (target: TaskStatus) => {
    setOver(null);
    const t = data?.find((x) => x.id === dragId);
    setDragId(null);
    if (!t || t.status === target) return;
    if (!canMove(t)) {
      toast('Исполнитель может перемещать только свои задачи', 'error');
      return;
    }
    // Задача без исполнителя: руководителю предлагается назначить лучшего кандидата автоматически
    if (!t.assigneeId && target !== 'new') {
      if (!isManager) return;
      const ok = await confirm({
        title: 'Задача ещё не назначена',
        message: `У задачи «${t.title}» нет исполнителя. Подобрать лучшего кандидата автоматически и перенести задачу в колонку «${STATUS_LABELS[target]}»?`,
        confirmText: 'Назначить и перенести',
      });
      if (!ok) return;
      move.mutate({ id: t.id, status: target, autoAssign: true });
      return;
    }
    if (target === 'new' && t.assigneeId) {
      toast('Чтобы вернуть задачу в «Новая», снимите назначение: выберите другого исполнителя в карточке задачи', 'error');
      return;
    }
    if (target === 'done') {
      const ok = await confirm({
        title: 'Завершить задачу?',
        message: 'Фактические трудозатраты будут приняты равными оценке. Точное значение можно указать в карточке задачи.',
        confirmText: 'Завершить',
      });
      if (!ok) return;
    }
    move.mutate({ id: t.id, status: target });
  };

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
              onDrop={() => drop(s)}
            >
              <h3>
                {STATUS_LABELS[s]} <span className="count">{items.length}</span>
              </h3>
              <div className="column-body">
                {items.map((t) => (
                  <article
                    key={t.id}
                    className={`card-task prio-border-${t.priority} ${canMove(t) ? '' : 'card-locked'}`}
                    draggable={canMove(t)}
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => setOpenId(t.id)}
                  >
                    <div className="cell-title">{t.title}</div>
                    <div className="row-gap between">
                      <PriorityBadge p={t.priority} />
                      <span className={t.overdue ? 'danger small' : 'muted small'}>{formatDate(t.deadline)}</span>
                    </div>
                    <div className="small muted">
                      {t.assigneeName ?? 'не назначена'} · {t.estimateHours} ч
                    </div>
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
