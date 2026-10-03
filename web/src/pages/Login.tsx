import { useState } from 'react';
import { useAuth } from '../auth.tsx';
import Field, { EMAIL_RE, PasswordInput, sanitizeEmail, useTouched } from '../components/Field.tsx';

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
  const tc = useTouched();
  const emailErr = email.trim() === '' ? 'Введите адрес электронной почты' : !EMAIL_RE.test(email.trim()) ? 'Некорректный адрес. Пример: name@company.ru' : undefined;
  const passErr = password === '' ? 'Введите пароль' : undefined;

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
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          tc.submit();
          if (emailErr || passErr) return;
          submit(email.trim(), password);
        }}
      >
        <div className="brand brand-lg">
          <span className="brand-mark">✓</span>
          <span>SmartAssign</span>
        </div>
        <p className="muted">Интеллектуальная система распределения задач сотрудникам</p>
        <Field label="Электронная почта" error={tc.show('email', emailErr)}>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(sanitizeEmail(e.target.value))} onBlur={() => tc.touch('email')} aria-invalid={!!tc.show('email', emailErr)} />
        </Field>
        <Field label="Пароль" error={tc.show('password', passErr)}>
          <PasswordInput autoComplete="current-password" value={password} onChange={setPassword} onBlur={() => tc.touch('password')} invalid={!!tc.show('password', passErr)} />
        </Field>
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
