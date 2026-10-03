import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api.ts';
import { useAuth } from '../auth.tsx';
import Field, { EMAIL_RE, formatName, mapServerErrors, normalizeDecimal, parseNumber, PasswordInput, sanitizeDecimal, sanitizeEmail, sanitizeName, useTouched } from '../components/Field.tsx';
import SkillsEditor from '../components/SkillsEditor.tsx';
import { LoadBar, Modal, Spinner } from '../components/ui.tsx';
import { useToast } from '../toast.tsx';
import { ROLE_LABELS, type Employee } from '../types.ts';

function EmployeeForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'employee', position: '', capacityHoursWeek: '40' });
  const [noPatronymic, setNoPatronymic] = useState(false);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const tc = useTouched();

  const errors = (() => {
    const e: Partial<Record<'name' | 'email' | 'password' | 'position' | 'capacity', string>> = {};
    const name = form.name.trim();
    const words = name.split(/\s+/).filter(Boolean);
    if (name === '') e.name = 'Введите ФИО сотрудника';
    else if (!noPatronymic && words.length < 3) e.name = words.length < 2 ? 'Укажите фамилию, имя и отчество полностью, а не только имя' : 'Не указано отчество. Введите его или отметьте «Без отчества»';
    else if (noPatronymic && words.length !== 2) e.name = 'При отметке «Без отчества» укажите только фамилию и имя';
    else if (words.some((w) => w.replace(/[^\p{L}]/gu, '').length < 2)) e.name = 'Каждая часть ФИО должна содержать не менее 2 букв';
    else if (!/^[\p{L}][\p{L}'’-]*(\s+[\p{L}][\p{L}'’-]*)+$/u.test(name)) e.name = 'ФИО может содержать только буквы, дефис и апостроф';
    else if (name.length > 120) e.name = 'ФИО должно быть не длиннее 120 символов';
    if (form.email.trim() === '') e.email = 'Введите адрес электронной почты';
    else if (!EMAIL_RE.test(form.email.trim())) e.email = 'Некорректный адрес. Пример: name@company.ru';
    if (form.password === '') e.password = 'Задайте пароль';
    else if (form.password.length < 8) e.password = 'Пароль должен содержать не менее 8 символов';
    else if (form.password.length > 100) e.password = 'Пароль должен быть не длиннее 100 символов';
    else if (!/[A-Za-zА-Яа-я]/.test(form.password) || !/\d/.test(form.password)) e.password = 'Пароль должен содержать буквы и цифры';
    const pos = form.position.trim();
    if (pos === '') e.position = 'Укажите должность сотрудника';
    else if (pos.length < 2 || !/\p{L}/u.test(pos)) e.position = 'Должность должна содержать буквы (не менее 2 символов)';
    else if (pos.length > 120) e.position = 'Должность должна быть не длиннее 120 символов';
    const cap = parseNumber(form.capacityHoursWeek);
    if (form.capacityHoursWeek.trim() === '') e.capacity = 'Укажите число часов в неделю';
    else if (cap === null) e.capacity = 'Введите число';
    else if (cap < 1 || cap > 80) e.capacity = 'Допустимо от 1 до 80 часов в неделю';
    return e;
  })();

  const create = useMutation({
    mutationFn: () => api('/employees', { body: { ...form, noPatronymic, name: formatName(form.name), position: form.position.trim(), email: form.email.trim(), capacityHoursWeek: parseNumber(form.capacityHoursWeek) } }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['employees'] }), toast('Сотрудник добавлен'), onClose()),
    onError: (e: Error) => {
      const fields: Record<string, string> =
        e instanceof ApiError && e.status === 409
          ? { email: e.message }
          : e instanceof ApiError
            ? mapServerErrors(e.details, { name: 'ФИО', email: 'Электронная почта', password: 'Пароль', position: 'Должность', capacity: 'Недельная ёмкость' })
            : {};
      setServerErr(fields);
      toast(Object.keys(fields).length ? 'Проверьте отмеченные поля формы' : e.message, 'error');
    },
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const err = (k: keyof typeof errors) => tc.show(k, errors[k]) ?? (errors[k] ? undefined : serverErr[k]);

  return (
    <Modal title="Новый сотрудник" onClose={onClose}>
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          tc.submit();
          setServerErr({});
          if (Object.keys(errors).length > 0) return toast('Проверьте поля формы: есть ошибки', 'error');
          create.mutate();
        }}
      >
        <div className="field-group">
        <Field label="ФИО" error={err('name')}>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: sanitizeName(e.target.value) })} onBlur={() => (setForm({ ...form, name: formatName(form.name) }), tc.touch('name'))} aria-invalid={!!err('name')} placeholder={noPatronymic ? 'Например: Иванов Иван' : 'Например: Иванов Иван Иванович'} autoComplete="off" />
        </Field>
        <label className="check-row">
          <input type="checkbox" checked={noPatronymic} onChange={(e) => setNoPatronymic(e.target.checked)} />
          Без отчества
        </label>
        </div>
        <Field label="Электронная почта" error={err('email')}>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: sanitizeEmail(e.target.value) })} onBlur={() => tc.touch('email')} aria-invalid={!!err('email')} />
        </Field>
        <Field label="Пароль (не менее 8 символов, буквы и цифры)" error={err('password')}>
          <PasswordInput value={form.password} onChange={(v) => setForm({ ...form, password: v })} onBlur={() => tc.touch('password')} autoComplete="new-password" invalid={!!err('password')} />
        </Field>
        <div className="grid-3">
          <Field label="Роль">
            <select value={form.role} onChange={set('role')}>
              {Object.entries(ROLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Должность *" error={err('position')}>
            <input value={form.position} onChange={set('position')} onBlur={() => (setForm({ ...form, position: form.position.trim() }), tc.touch('position'))} aria-invalid={!!err('position')} maxLength={120} placeholder="Например: Разработчик" />
          </Field>
          <Field label="Часов в неделю" error={err('capacity')}>
            <input inputMode="decimal" value={form.capacityHoursWeek} onChange={(e) => setForm({ ...form, capacityHoursWeek: sanitizeDecimal(e.target.value, 5, 1) })} onBlur={() => (setForm({ ...form, capacityHoursWeek: normalizeDecimal(form.capacityHoursWeek) }), tc.touch('capacity'))} aria-invalid={!!err('capacity')} />
          </Field>
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

export default function Team() {
  const qc = useQueryClient();
  const toast = useToast();
  const { isManager, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['employees'], queryFn: () => api<Employee[]>('/employees') });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const toggle = useMutation({
    mutationFn: (e: Employee) => api(`/employees/${e.id}`, { method: 'PATCH', body: { available: !e.available } }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['employees'] }), qc.invalidateQueries({ queryKey: ['employee'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })),
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
          <article
            key={e.id}
            className={`card emp emp-link ${e.available ? '' : 'emp-off'}`}
            tabIndex={0}
            role="link"
            aria-label={`Открыть профиль: ${e.name}`}
            onClick={() => navigate(`/team/${e.id}`)}
            onKeyDown={(ev) => ev.key === 'Enter' && ev.target === ev.currentTarget && navigate(`/team/${e.id}`)}
          >
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
                <button className="btn btn-ghost btn-sm" onClick={(ev) => (ev.stopPropagation(), setEditing(e))}>
                  Навыки
                </button>
                <button className={`btn btn-sm ${e.available ? 'btn-ghost' : 'btn-warn'}`} onClick={(ev) => (ev.stopPropagation(), toggle.mutate(e))}>
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
