import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api.ts';
import Field, { parseNumber, sanitizeInt, useTouched } from '../components/Field.tsx';
import { useToast } from '../toast.tsx';
import type { SimMetrics, SimulationResult } from '../types.ts';

const METRICS: { key: keyof SimMetrics; label: string; unit: string }[] = [
  { key: 'mismatchRate', label: 'Назначения без требуемых навыков', unit: '%' },
  { key: 'lateRate', label: 'Задачи, выполненные с опозданием', unit: '%' },
  { key: 'criticalLateRate', label: 'Критические и высокие с опозданием', unit: '%' },
  { key: 'loadStd', label: 'Разброс загрузки (σ)', unit: 'п. п.' },
  { key: 'makespanDays', label: 'Срок завершения всех задач', unit: 'раб. дн.' },
];

function Chart({ data, metric }: { data: SimulationResult; metric: (typeof METRICS)[number] }) {
  const max = Math.max(...data.strategies.map((s) => s.metrics[metric.key]), 1e-9);
  return (
    <div className="card">
      <h3>{metric.label}</h3>
      <ul className="bars">
        {data.strategies.map((s) => {
          const v = s.metrics[metric.key];
          const smart = s.key.startsWith('smart');
          return (
            <li key={s.key}>
              <span className="bars-label">{s.label}</span>
              <div className="bars-track">
                <div className={`bars-fill ${smart ? 'bars-smart' : ''}`} style={{ width: `${(v / max) * 100}%` }} />
              </div>
              <span className="bars-value">
                {v.toFixed(1)} {metric.unit}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Experiment() {
  const toast = useToast();
  const [employees, setEmployees] = useState('12');
  const [tasks, setTasks] = useState('60');
  const [runs, setRuns] = useState('20');
  const tc = useTouched();
  const check = (raw: string, min: number, max: number, what: string) => {
    const n = parseNumber(raw);
    if (raw.trim() === '') return `Укажите ${what}`;
    if (n === null || !Number.isInteger(n)) return 'Введите целое число';
    if (n < min || n > max) return `Допустимо от ${min} до ${max}`;
    return undefined;
  };
  const errs = { employees: check(employees, 3, 60, 'число сотрудников'), tasks: check(tasks, 5, 300, 'число задач'), runs: check(runs, 1, 50, 'число прогонов') };
  const run = useMutation({
    mutationFn: () => api<SimulationResult>('/simulation', { body: { employees: Number(employees), tasks: Number(tasks), runs: Number(runs), seed: 2025 } }),
    onError: (e: Error) => toast(e.message, 'error'),
  });

  return (
    <>
      <header className="page-head">
        <h1>Эксперимент</h1>
        <p className="muted">Сравнение стратегий распределения на синтетических данных с известными «истинными» характеристиками исполнителей</p>
      </header>
      <section className="card">
        <div className="grid-3">
          <Field label="Сотрудников (от 3 до 60)" error={tc.show('employees', errs.employees)}>
            <input inputMode="numeric" value={employees} onChange={(e) => setEmployees(sanitizeInt(e.target.value, 3))} onBlur={() => tc.touch('employees')} aria-invalid={!!tc.show('employees', errs.employees)} />
          </Field>
          <Field label="Задач (от 5 до 300)" error={tc.show('tasks', errs.tasks)}>
            <input inputMode="numeric" value={tasks} onChange={(e) => setTasks(sanitizeInt(e.target.value, 3))} onBlur={() => tc.touch('tasks')} aria-invalid={!!tc.show('tasks', errs.tasks)} />
          </Field>
          <Field label="Прогонов (от 1 до 50)" error={tc.show('runs', errs.runs)}>
            <input inputMode="numeric" value={runs} onChange={(e) => setRuns(sanitizeInt(e.target.value, 3))} onBlur={() => tc.touch('runs')} aria-invalid={!!tc.show('runs', errs.runs)} />
          </Field>
        </div>
        <button className="btn btn-primary btn-run" onClick={() => {
            tc.submit();
            if (Object.values(errs).some(Boolean)) return toast('Проверьте параметры эксперимента', 'error');
            run.mutate();
          }} disabled={run.isPending}>
          {run.isPending ? 'Расчёт…' : 'Запустить эксперимент'}
        </button>
      </section>

      {run.data && (
        <>
          <div className="grid-2 section">
            {METRICS.slice(0, 4).map((m) => (
              <Chart key={m.key} data={run.data} metric={m} />
            ))}
          </div>
          <section className="section">
            <div className="table-wrap card-flush">
              <table className="table">
                <thead>
                  <tr>
                    <th>Стратегия</th>
                    {METRICS.map((m) => (
                      <th key={m.key}>
                        {m.label}, {m.unit}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {run.data.strategies.map((s) => (
                    <tr key={s.key} className={s.key.startsWith('smart') ? 'row-accent' : ''}>
                      <td>{s.label}</td>
                      {METRICS.map((m) => (
                        <td key={m.key}>{s.metrics[m.key].toFixed(1)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
