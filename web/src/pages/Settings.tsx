import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { CRITERIA_COLORS } from '../components/ui.tsx';
import { useToast } from '../toast.tsx';
import { CRITERIA_LABELS, type Components, type Weights } from '../types.ts';

const HINTS: Record<keyof Components, string> = {
  skill: 'Насколько высоко исполнитель владеет требуемыми навыками',
  load: 'Свободная ёмкость исполнителя после назначения задачи',
  deadline: 'Успеет ли исполнитель к сроку с учётом очереди',
  speed: 'Историческая скорость выполнения относительно оценки',
  reliability: 'Доля задач, выполненных в срок (со сглаживанием)',
};

export default function Settings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['weights'], queryFn: () => api<Weights>('/settings/weights') });
  const [w, setW] = useState<Weights | null>(null);
  useEffect(() => {
    if (data) setW(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (v: Weights) => api<Weights>('/settings/weights', { method: 'PUT', body: v }),
    onSuccess: (r) => (setW(r), qc.invalidateQueries({ queryKey: ['weights'] }), qc.invalidateQueries({ queryKey: ['recommend'] }), toast('Веса сохранены')),
    onError: (e: Error) => toast(e.message, 'error'),
  });

  if (!w) return null;
  const keys = Object.keys(CRITERIA_LABELS) as (keyof Components)[];
  const rawSum = keys.reduce((s, k) => s + w[k], 0);
  const sum = rawSum || 1;
  const zeroError = rawSum <= 0 ? 'Хотя бы один вес должен быть больше нуля' : undefined;

  return (
    <>
      <header className="page-head">
        <h1>Настройка алгоритма</h1>
        <p className="muted">Веса критериев определяют, что важнее при подборе исполнителя. Значения автоматически нормируются на 100 %</p>
      </header>
      <section className="card">
        <div className="weights">
          {keys.map((k) => (
            <div key={k} className="weight-row">
              <div>
                <div className="cell-title">
                  <i className="dot" style={{ background: CRITERIA_COLORS[k] }} />
                  {CRITERIA_LABELS[k]}
                </div>
                <div className="small muted">{HINTS[k]}</div>
              </div>
              <input type="range" min={0} max={1} step={0.01} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} aria-label={CRITERIA_LABELS[k]} />
              <strong className="weight-pct">{((w[k] / sum) * 100).toFixed(0)} %</strong>
            </div>
          ))}
        </div>
        {zeroError && (
          <p className="field-error" role="alert">
            {zeroError}
          </p>
        )}
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={() => data && setW(data)}>
            Сбросить
          </button>
          <button className="btn btn-primary" onClick={() => (zeroError ? toast(zeroError, 'error') : save.mutate(w))} disabled={save.isPending}>
            Сохранить
          </button>
        </div>
      </section>
      <section className="card section">
        <h3>Как считается оценка</h3>
        <p>
          Итоговая оценка кандидата — взвешенная сумма пяти критериев со значениями от 0 до 1, приведённая к шкале 0–100. Перед расчётом действуют жёсткие
          ограничения: у сотрудника должны быть все требуемые навыки на нужном уровне, и он должен быть доступен. Для срочных задач веса срока и надёжности
          автоматически повышаются, а вес загрузки снижается.
        </p>
      </section>
    </>
  );
}
