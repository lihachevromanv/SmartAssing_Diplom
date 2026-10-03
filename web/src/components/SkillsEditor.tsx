import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { useToast } from '../toast.tsx';
import type { Employee, Skill } from '../types.ts';
import { Modal } from './ui.tsx';

export default function SkillsEditor({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: skills = [] } = useQuery({ queryKey: ['skills'], queryFn: () => api<Skill[]>('/skills') });
  const [levels, setLevels] = useState<Record<number, number>>(Object.fromEntries(emp.skills.map((s) => [s.skillId, s.level])));
  const save = useMutation({
    mutationFn: () => api(`/employees/${emp.id}`, { method: 'PATCH', body: { skills: Object.entries(levels).filter(([, l]) => l > 0).map(([id, level]) => ({ skillId: Number(id), level })) } }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['employees'] }), qc.invalidateQueries({ queryKey: ['employee', emp.id] }), toast('Навыки сохранены'), onClose()),
    onError: (e: Error) => toast(e.message, 'error'),
  });
  return (
    <Modal title={`Навыки: ${emp.name}`} onClose={onClose}>
      <div className="skill-editor">
        {skills.map((s) => (
          <label key={s.id} className="skill-row">
            <span>{s.name}</span>
            <select value={levels[s.id] ?? 0} onChange={(e) => setLevels({ ...levels, [s.id]: Number(e.target.value) })}>
              <option value={0}>нет</option>
              {[1, 2, 3, 4, 5].map((l) => (
                <option key={l} value={l}>
                  уровень {l}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
          Сохранить
        </button>
      </div>
    </Modal>
  );
}

