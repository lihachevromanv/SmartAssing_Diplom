import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { ROLE_LABELS } from '../types.ts';

const NAV = [
  { to: '/', label: 'Обзор', icon: '▦', end: true },
  { to: '/tasks', label: 'Задачи', icon: '☰' },
  { to: '/board', label: 'Доска', icon: '◫' },
  { to: '/team', label: 'Команда', icon: '☺' },
  { to: '/distribution', label: 'Распределение', icon: '⇄', manager: true },
  { to: '/experiment', label: 'Эксперимент', icon: '∑', manager: true },
  { to: '/settings', label: 'Алгоритм', icon: '⚙', manager: true },
];

export default function Layout() {
  const { user, logout, isManager } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">✓</span>
          <span>SmartAssign</span>
        </div>
        <nav>
          {NAV.filter((n) => !n.manager || isManager).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span className="nav-icon" aria-hidden>
                {n.icon}
              </span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-name">{user?.name}</div>
          <div className="user-role">{user ? ROLE_LABELS[user.role] : ''}</div>
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            Выйти
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
