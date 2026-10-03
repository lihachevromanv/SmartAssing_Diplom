import { useState, type ReactNode } from 'react';

/** Поле формы: подпись, элемент ввода и сообщение об ошибке на русском языке. */
export default function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className={`field ${error ? 'field-invalid' : ''}`}>
      {label}
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </label>
  );
}

export type Errors<K extends string> = Partial<Record<K, string>>;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Проверка числа, введённого строкой (допускается запятая как десятичный разделитель). */
export function parseNumber(raw: string): number | null {
  const n = Number(raw.trim().replace(',', '.'));
  return raw.trim() !== '' && Number.isFinite(n) ? n : null;
}

/** Оставляет только цифры и один десятичный разделитель (запятую); точка заменяется запятой. */
export function sanitizeDecimal(raw: string, maxLen = 8, maxDecimals = 2): string {
  let out = raw.replace('.', ',').replace(/[^0-9,]/g, '');
  const first = out.indexOf(',');
  if (first >= 0) out = out.slice(0, first + 1) + out.slice(first + 1).replace(/,/g, '').slice(0, maxDecimals);
  return out.slice(0, maxLen);
}

/** Адрес почты: пробелы не вводятся. */
export function sanitizeEmail(raw: string): string {
  return raw.replace(/\s/g, '').slice(0, 254);
}

/** ФИО: допускаются буквы, пробел, дефис и апостроф; цифры и прочие символы удаляются при вводе. */
export function sanitizeName(raw: string, maxLen = 120): string {
  return raw
    .replace(/[^\p{L}\s'’-]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s+/, '')
    .slice(0, maxLen);
}

/** Приводит ФИО к виду «Иванов Иван Иванович»: лишние пробелы удаляются, каждая часть с заглавной буквы. */
export function formatName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('ru')))
    .join(' ');
}

/** Приводит число к виду «7,5»: убирает ведущие нули и лишнюю запятую в конце. */
export function normalizeDecimal(raw: string): string {
  const t = raw.trim().replace(/,$/, '');
  if (!/^\d+(,\d+)?$/.test(t)) return raw;
  return String(Number(t.replace(',', '.'))).replace('.', ',');
}

/** Разбирает ответ сервера с ошибками вида «Метка: сообщение» по полям формы. */
export function mapServerErrors(details: string[], labels: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of details) {
    const i = d.indexOf(': ');
    if (i < 0) continue;
    const key = Object.keys(labels).find((k) => labels[k] === d.slice(0, i));
    if (key && !out[key]) out[key] = d.slice(i + 2);
  }
  return out;
}

/** Оставляет только цифры. */
export function sanitizeInt(raw: string, maxLen = 4): string {
  return raw.replace(/\D/g, '').slice(0, maxLen);
}

/** Показ ошибок поля после ухода из него или после попытки отправки формы. */
export function useTouched() {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  return {
    submitted,
    submit: () => setSubmitted(true),
    touch: (k: string) => setTouched((t) => (t[k] ? t : { ...t, [k]: true })),
    show: (k: string, error: string | undefined) => (submitted || touched[k] ? error : undefined),
  };
}

/** Поле пароля с кнопкой показа и скрытия вводимого текста. */
export function PasswordInput({ value, onChange, onBlur, invalid, autoComplete }: { value: string; onChange: (v: string) => void; onBlur?: () => void; invalid?: boolean; autoComplete?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input type={visible ? 'text' : 'password'} value={value} autoComplete={autoComplete} maxLength={100} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
      <button type="button" className="password-toggle" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={visible} title={visible ? 'Скрыть пароль' : 'Показать пароль'}>
        {visible ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
