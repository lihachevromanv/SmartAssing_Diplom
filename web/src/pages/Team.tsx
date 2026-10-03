import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { LoadBar, Modal, Spinner } from '../components/ui.tsx';
import { useToast } from '../toast.tsx';
import { ROLE_LABELS, type Employee, type Skill } from '../types.ts';

function EmployeeForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'employee', position: '', capacityHoursWeek: '40' });
  const create = useMutation({
    mutationFn: () => api('/employees', { body: { ...form, capacityHoursWeek: Number(form.capacityHoursWeek) } }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['employees'] }), toast('Сотрудник добавлен'), onClose()),
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal title="Новый сотрудник" onClose={onClose}>
      <form className="form" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
        <label>
          ФИО
          <input required value={form.name} onChange={set('name')} />
        </label>
        <label>
          Электронная почта
          <input required type="email" value={form.email} onChange={set('email')} />
        </label>
        <label>
          Пароль (не менее 8 символов)
          <input required type="password" minLength={8} value={form.password} onChange={set('password')} autoComplete="new-password" />
        </label>
        <div className="grid-3">
          <label>
            Роль
            <select value={form.role} onChange={set('role')}>
              {Object.entries(ROLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Должность
            <input value={form.position} onChange={set('position')} />
          </label>
          <label>
            Часов в неделю
            <input type="number" min="1" max="80" value={form.capacityHoursWeek} onChange={set('capacityHoursWeek')} />
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={create.isPending}>
            Добавить
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SkillsEditor({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: skills = [] } = useQuery({ queryKey: ['skills'], queryFn: () => api<Skill[]>('/skills') });
  const [levels, setLevels] = useState<Record<number, number>>(Object.fromEntries(emp.skills.map((s) => [s.skillId, s.level])));
  const save = useMutation({
    mutationFn: () => api(`/employees/${emp.id}`, { method: 'PATCH', body: { skills: Object.entries(levels).filter(([, l]) => l > 0).map(([id, level]) => ({ skillId: Number(id), level })) } }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['employees' ] }), toast('Навыки сохранены'), onClose()),
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

export default function Team() {
  const qc = useQueryClient();
  const toast = useToast();
  const { isManager, isAdmin } = useAuth();
  const { data } = useQuery({ queryKey: ['employees'], queryFn: () => api<Employee[]>('/employees') });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const toggle = useMutation({
    mutationFn: (e: Employee) => api(`/employees/${e.id}`, { method: 'PATCH', body: { available: !e.available } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
    onError: (e: Error) => toast(e.message, 'error'),
  });

  if (!data) return <Spinner />;
  return (
    <>
      <header className="page-head page-head-row">
        <div>
          <h1>Команда</h1>
          <p className="muted">Навыки, загрузка и показатели исполнителей</p>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Сотрудник
          </button>
        )}
      </header>
      <div className="cards">
        {data.map((e) => (
          <article key={e.id} className={`card emp ${e.available ? '' : 'emp-off'}`}>
            <div className="emp-head">
              <div className="avatar">{e.name.split(' ').slice(0, 2).map((p) => p[0]).join('')}</div>
              <div>
                <div className="cell-title">{e.name}</div>
                <div className="muted small">{e.position || ROLE_LABELS[e.role]}</div>
              </div>
            </div>
            <div className="chips">
              {e.skills.map((s) => (
                <span key={s.skillId} className="chip">
                  {s.name} <b>{s.level}</b>
                </span>
              ))}
            </div>
            <div className="emp-load">
              <div className="row-gap between small">
                <span>Загрузка (к недельной ёмкости)</span>
                <span>
                  {e.loadHours} ч · {e.loadPct.toFixed(0)} %
                </span>
              </div>
              <LoadBar pct={e.loadPct} />
            </div>
            <div className="row-gap between small muted">
              <span>Скорость ×{e.speedFactor.toFixed(2)}</span>
              <span>
                В срок: {e.doneCount ? `${e.onTimeCount}/${e.doneCount}` : '—'}
              </span>
              <span>{e.capacityHoursWeek} ч/нед</span>
            </div>
            {isManager && (
              <div className="row-gap">
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(e)}>
                  Навыки
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => toggle.mutate(e)}>
                  {e.available ? 'Отметить недоступным' : 'Вернуть в работу'}
                </button>
              </div>
            )}
            {!e.available && <span className="badge badge-warn">Недоступен</span>}
          </article>
        ))}
      </div>
      {adding && <EmployeeForm onClose={() => setAdding(false)} />}
      {editing && <SkillsEditor emp={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
