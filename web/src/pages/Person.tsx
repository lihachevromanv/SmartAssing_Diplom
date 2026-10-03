import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api.ts';
import { useAuth } from '../auth.tsx';
import SkillsEditor from '../components/SkillsEditor.tsx';
import TaskDialog from '../components/TaskDialog.tsx';
import { Empty, formatDate, LoadBar, PriorityBadge, Spinner, StatusBadge } from '../components/ui.tsx';
import { useToast } from '../toast.tsx';
import { ROLE_LABELS, type Employee, type Task } from '../types.ts';

function TaskTable({ tasks, onOpen, empty }: { tasks: Task[]; onOpen: (id: number) => void; empty: string }) {
  if (tasks.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap card-flush">
      <table className="table table-hover">
        <thead>
          <tr>
            <th>Задача</th>
            <th>Приоритет</th>
            <th>Статус</th>
            <th>Срок</th>
            <th>Часы</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} tabIndex={0} onClick={() => onOpen(t.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(t.id)}>
              <td className="cell-title">{t.title}</td>
              <td>
                <PriorityBadge p={t.priority} />
              </td>
              <td>
                <StatusBadge s={t.status} />
              </td>
              <td className={t.overdue ? 'danger' : ''}>{formatDate(t.status === 'done' ? t.completedAt : t.deadline)}</td>
              <td>{t.status === 'done' && t.actualHours ? `${t.actualHours} (оценка ${t.estimateHours})` : t.estimateHours}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Person() {
  const { id } = useParams();
  const empId = Number(id);
  const qc = useQueryClient();
  const toast = useToast();
  const { isManager } = useAuth();
  const [editing, setEditing] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const { data: emp, error } = useQuery({ queryKey: ['employee', empId], queryFn: () => api<Employee>(`/employees/${empId}`), enabled: Number.isInteger(empId) });
  const { data: tasks } = useQuery({ queryKey: ['tasks', 'assignee', empId], queryFn: () => api<Task[]>(`/tasks?assignee=${empId}`), enabled: Number.isInteger(empId) });

  const toggle = useMutation({
    mutationFn: () => api(`/employees/${empId}`, { method: 'PATCH', body: { available: !emp?.available } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee', empId] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  if (error) {
    return (
      <>
        <Link to="/team" className="back-link">
          ← Команда
        </Link>
        <Empty>{error instanceof ApiError && error.status === 404 ? 'Сотрудник не найден' : 'Не удалось загрузить профиль'}</Empty>
      </>
    );
  }
  if (!emp || !tasks) return <Spinner />;

  const open = tasks.filter((t) => t.status !== 'done');
  const done = tasks.filter((t) => t.status === 'done').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  const onTime = emp.doneCount ? Math.round((emp.onTimeCount / emp.doneCount) * 100) : null;

  return (
    <>
      <Link to="/team" className="back-link">
        ← Команда
      </Link>
      <header className="person-head card">
        <div className="avatar avatar-lg">{emp.name.split(' ').slice(0, 2).map((p) => p[0]).join('')}</div>
        <div className="person-main">
          <h1>{emp.name}</h1>
          <p className="muted">
            {emp.position || ROLE_LABELS[emp.role]} · {ROLE_LABELS[emp.role]} · {emp.email}
          </p>
          {!emp.available && <span className="badge badge-warn">Недоступен</span>}
        </div>
        {isManager && (
          <div className="row-gap">
            <button className="btn btn-ghost" onClick={() => setEditing(true)}>
              Изменить навыки
            </button>
            <button className={`btn ${emp.available ? 'btn-ghost' : 'btn-warn'}`} onClick={() => toggle.mutate()} disabled={toggle.isPending}>
              {emp.available ? 'Отметить недоступным' : 'Вернуть в работу'}
            </button>
          </div>
        )}
      </header>

      <div className="kpi-grid kpi-grid-5">
        <div className="kpi">
          <div className="kpi-label">Загрузка</div>
          <div className="kpi-value">{emp.loadPct.toFixed(0)} %</div>
          <div className="kpi-hint">{emp.loadHours} ч к недельной ёмкости</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Ёмкость</div>
          <div className="kpi-value">{emp.capacityHoursWeek} ч</div>
          <div className="kpi-hint">в неделю</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Скорость</div>
          <div className="kpi-value">×{emp.speedFactor.toFixed(2)}</div>
          <div className="kpi-hint">по истории задач</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Выполнено</div>
          <div className="kpi-value">{emp.doneCount}</div>
          <div className="kpi-hint">задач</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">В срок</div>
          <div className="kpi-value">{onTime == null ? '—' : `${onTime} %`}</div>
          <div className="kpi-hint">{emp.doneCount ? `${emp.onTimeCount} из ${emp.doneCount}` : 'нет данных'}</div>
        </div>
      </div>

      <div className="grid-2 person-grid">
        <section className="card">
          <h3>Навыки</h3>
          {emp.skills.length === 0 ? (
            <p className="muted">Навыки не указаны</p>
          ) : (
            <ul className="skill-bars">
              {emp.skills.map((s) => (
                <li key={s.skillId}>
                  <span>{s.name}</span>
                  <div className="skill-track" title={`Уровень ${s.level} из 5`}>
                    <div style={{ width: `${(s.level / 5) * 100}%` }} />
                  </div>
                  <b>{s.level}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h3>Текущая загрузка</h3>
          <LoadBar pct={emp.loadPct} />
          <p className="muted small">
            Остаток работ по открытым задачам: {emp.loadHours} ч из {emp.capacityHoursWeek} ч недельной ёмкости.
          </p>
        </section>
      </div>

      <section className="section">
        <h2 className="h2">Задачи в работе ({open.length})</h2>
        <TaskTable tasks={open} onOpen={setOpenId} empty="Открытых задач нет" />
      </section>
      <section className="section">
        <h2 className="h2">Выполненные задачи ({done.length})</h2>
        <TaskTable tasks={done.slice(0, 15)} onOpen={setOpenId} empty="Выполненных задач пока нет" />
      </section>

      {editing && <SkillsEditor emp={emp} onClose={() => setEditing(false)} />}
      {openId != null && <TaskDialog taskId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
