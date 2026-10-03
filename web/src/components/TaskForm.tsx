import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { useToast } from '../toast.tsx';
import { PRIORITY_LABELS, type Skill, type Task } from '../types.ts';
import { Modal } from './ui.tsx';

export default function TaskForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: skills = [] } = useQuery({ queryKey: ['skills'], queryFn: () => api<Skill[]>('/skills') });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(3);
  const [hours, setHours] = useState('8');
  const [deadline, setDeadline] = useState('');
  const [reqs, setReqs] = useState<{ skillId: number; minLevel: number }[]>([]);

  const create = useMutation({
    mutationFn: () =>
      api<Task>('/tasks', {
        body: { title, description, priority, estimateHours: Number(hours), deadline: deadline || null, requirements: reqs },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('Задача создана');
      onClose();
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  const free = skills.filter((s) => !reqs.some((r) => r.skillId === s.id));

  return (
    <Modal title="Новая задача" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label>
          Название
          <input required minLength={3} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: разработать модуль отчётов" />
        </label>
        <label>
          Описание
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="grid-3">
          <label>
            Приоритет
            <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
              {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Трудоёмкость, ч
            <input required type="number" min="0.5" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
          </label>
          <label>
            Срок
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
        </div>
        <fieldset>
          <legend>Требуемые навыки</legend>
          {reqs.map((r) => (
            <div key={r.skillId} className="req-row">
              <span>{skills.find((s) => s.id === r.skillId)?.name}</span>
              <label className="inline">
                мин. уровень
                <select value={r.minLevel} onChange={(e) => setReqs(reqs.map((x) => (x.skillId === r.skillId ? { ...x, minLevel: Number(e.target.value) } : x)))}>
                  {[1, 2, 3, 4, 5].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="icon-btn" onClick={() => setReqs(reqs.filter((x) => x.skillId !== r.skillId))} aria-label="Убрать навык">
                ×
              </button>
            </div>
          ))}
          {free.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && setReqs([...reqs, { skillId: Number(e.target.value), minLevel: 3 }])}
              aria-label="Добавить навык"
            >
              <option value="">+ Добавить навык…</option>
              {free.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </fieldset>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={create.isPending}>
            Создать
          </button>
        </div>
      </form>
    </Modal>
  );
}
