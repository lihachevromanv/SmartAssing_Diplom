import { useState } from 'react';
import { useAuth } from '../auth.tsx';

const DEMO = [
  { label: 'Руководитель', email: 'manager@smartassign.local', password: 'Manager#2025' },
  { label: 'Сотрудник', email: 'ivanov@smartassign.local', password: 'Employee#2025' },
  { label: 'Администратор', email: 'admin@smartassign.local', password: 'Admin#2025' },
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: string, p: string) => {
    setBusy(true);
    setError('');
    try {
      await login(e, p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          submit(email, password);
        }}
      >
        <div className="brand brand-lg">
          <span className="brand-mark">✓</span>
          <span>SmartAssign</span>
        </div>
        <p className="muted">Интеллектуальная система распределения задач сотрудникам</p>
        <label>
          Электронная почта
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Пароль
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          Войти
        </button>
        <div className="demo">
          <span className="small muted">Демонстрационный вход (локальный стенд):</span>
          <div className="row-gap">
            {DEMO.map((d) => (
              <button type="button" key={d.email} className="btn btn-ghost btn-sm" disabled={busy} onClick={() => submit(d.email, d.password)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </form>
    </div>
  );
}
