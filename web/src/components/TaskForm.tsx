import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api.ts';
import { useToast } from '../toast.tsx';
import { PRIORITY_LABELS, type Skill, type Task } from '../types.ts';
import { useConfirm } from './Confirm.tsx';
import DateField, { todayIso } from './DateField.tsx';
import Field, { mapServerErrors, normalizeDecimal, parseNumber, sanitizeDecimal, useTouched, type Errors } from './Field.tsx';
import { Modal } from './ui.tsx';

type Key = 'title' | 'description' | 'hours' | 'deadline';

/** Форма создания задачи; при передаче task работает как форма редактирования. */
export default function TaskForm({ task, onClose }: { task?: Task; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: skills = [] } = useQuery({ queryKey: ['skills'], queryFn: () => api<Skill[]>('/skills') });
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [priority, setPriority] = useState(task?.priority ?? 3);
  const [hours, setHours] = useState(String(task?.estimateHours ?? 8));
  const [deadline, setDeadline] = useState(task?.deadline ?? '');
  const [dateMsg, setDateMsg] = useState<string | undefined>();
  const onDateValidity = useCallback((_valid: boolean, reason?: string) => setDateMsg(reason), []);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const [reqs, setReqs] = useState<{ skillId: number; minLevel: number }[]>(task?.requirements.map((r) => ({ skillId: r.skillId, minLevel: r.minLevel })) ?? []);
  const tc = useTouched();

  const validate = (): Errors<Key> => {
    const e: Errors<Key> = {};
    const t = title.trim();
    if (t === '') e.title = 'Введите название задачи';
    else if (t.length < 3) e.title = 'Название должно содержать не менее 3 символов';
    else if (t.length > 200) e.title = 'Название должно быть не длиннее 200 символов';
    else if (!/\p{L}/u.test(t)) e.title = 'Название должно содержать буквы, а не только цифры и символы';
    if (description.length > 5000) e.description = 'Описание должно быть не длиннее 5000 символов';
    const h = parseNumber(hours);
    if (hours.trim() === '') e.hours = 'Укажите трудоёмкость в часах';
    else if (h === null) e.hours = 'Трудоёмкость должна быть числом';
    else if (h <= 0) e.hours = 'Трудоёмкость должна быть больше нуля';
    else if (h > 1000) e.hours = 'Трудоёмкость не может превышать 1000 часов';
    else if (!/^\d+(,\d{1,2})?$/.test(hours.trim())) e.hours = 'Введите число, например 8 или 7,5 (не более двух знаков после запятой)';
    if (dateMsg) e.deadline = dateMsg;
    else if (deadline && deadline < todayIso() && deadline !== task?.deadline) e.deadline = 'Срок не может быть в прошлом';
    else if (deadline && Number(deadline.slice(0, 4)) > new Date().getFullYear() + 10) e.deadline = 'Срок слишком далёкий: не позднее чем через 10 лет';
    return e;
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { title: title.trim(), description, priority, estimateHours: parseNumber(hours), deadline: deadline || null, requirements: reqs };
      return task ? api<Task>(`/tasks/${task.id}`, { method: 'PATCH', body }) : api<Task>('/tasks', { body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (task) {
        qc.invalidateQueries({ queryKey: ['task', task.id] });
        qc.invalidateQueries({ queryKey: ['recommend', task.id] });
        qc.invalidateQueries({ queryKey: ['employees'] });
      }
      toast(task ? 'Изменения сохранены' : 'Задача создана');
      onClose();
    },
    onError: (e: Error) => {
      const fields = e instanceof ApiError ? mapServerErrors(e.details, { title: 'Название', description: 'Описание', hours: 'Трудоёмкость', deadline: 'Срок' }) : {};
      setServerErr(fields);
      toast(Object.keys(fields).length ? 'Сервер отклонил данные: проверьте отмеченные поля' : e.message, 'error');
    },
  });

  const submit = async () => {
    tc.submit();
    const e = validate();
    if (Object.keys(e).length > 0) {
      toast('Проверьте поля формы: есть ошибки', 'error');
      return;
    }
    setServerErr({});
    if (task) {
      const same =
        title.trim() === task.title &&
        description === task.description &&
        priority === task.priority &&
        parseNumber(hours) === task.estimateHours &&
        (deadline || null) === task.deadline &&
        JSON.stringify([...reqs].sort((a, b) => a.skillId - b.skillId)) === JSON.stringify(task.requirements.map((r) => ({ skillId: r.skillId, minLevel: r.minLevel })).sort((a, b) => a.skillId - b.skillId));
      if (same) {
        toast('Изменений нет: параметры задачи не менялись');
        onClose();
        return;
      }
      const ok = await confirm({
        title: 'Сохранить изменения?',
        message: `Параметры задачи «${task.title}» будут изменены. Рекомендации по исполнителю пересчитаются.`,
        confirmText: 'Сохранить',
      });
      if (!ok) return;
    }
    save.mutate();
  };

  // после первой попытки отправки ошибки пересчитываются при каждом изменении
  const all = validate();
  const shown: Errors<Key> = {
    title: tc.show('title', all.title) ?? (all.title ? undefined : serverErr.title),
    description: tc.show('description', all.description) ?? (all.description ? undefined : serverErr.description),
    hours: tc.show('hours', all.hours) ?? (all.hours ? undefined : serverErr.hours),
    deadline: tc.show('deadline', all.deadline) ?? (all.deadline ? undefined : serverErr.deadline),
  };
  const free = skills.filter((s) => !reqs.some((r) => r.skillId === s.id));

  return (
    <Modal title={task ? `Редактирование задачи №${task.id}` : 'Новая задача'} onClose={onClose}>
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Название" error={shown.title}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => (setTitle(title.replace(/\s+/g, ' ').trim()), tc.touch('title'))} placeholder="Например: разработать модуль отчётов" aria-invalid={!!shown.title} maxLength={220} />
        </Field>
        <Field label="Описание" error={shown.description}>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => tc.touch('description')} aria-invalid={!!shown.description} />
        </Field>
        <div className="grid-3">
          <Field label="Приоритет">
            <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
              {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Трудоёмкость, ч" error={shown.hours}>
            <input inputMode="decimal" value={hours} onChange={(e) => setHours(sanitizeDecimal(e.target.value))} onBlur={() => (setHours(normalizeDecimal(hours)), tc.touch('hours'))} aria-invalid={!!shown.hours} placeholder="Например: 8 или 7,5" />
          </Field>
          <DateField label="Срок" value={deadline} onChange={setDeadline} onValidity={onDateValidity} onBlur={() => tc.touch('deadline')} error={shown.deadline} />
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
            <select value="" onChange={(e) => e.target.value && setReqs([...reqs, { skillId: Number(e.target.value), minLevel: 3 }])} aria-label="Добавить навык">
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
          <button className="btn btn-primary" disabled={save.isPending}>
            {task ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
