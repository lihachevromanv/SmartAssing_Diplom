import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export const isoToRu = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

export function ruToIso(ru: string): string | null {
  const m = ru.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  const ok = date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(mo) - 1 && date.getUTCDate() === Number(d);
  return ok ? `${y}-${mo}-${d}` : null;
}

function mask(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length > 4) return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
  if (digits.length > 2) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return digits;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Календарь на русском языке: понедельник – первый день недели, закрывается после выбора даты. */
function Calendar({ value, onPick, onClear, onClose, anchor }: { value: string; onPick: (iso: string) => void; onClear: () => void; onClose: () => void; anchor: HTMLElement | null }) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayIso();
  const [year, setYear] = useState(Number(base.slice(0, 4)));
  const [month, setMonth] = useState(Number(base.slice(5, 7)) - 1);
  const today = todayIso();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // положение у поля ввода с учётом границ экрана; календарь выводится поверх окна
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor?.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 340;
      if (!r) return;
      const w = Math.min(300, window.innerWidth * 0.86);
      const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = r.top - h - 6 >= 8 ? r.top - h - 6 : Math.max(8, window.innerHeight - h - 8);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  const shift = (dm: number) => {
    const d = new Date(year, month + dm, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // понедельник = 0
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, month, 1 - offset + i);
    return { iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, day: d.getDate(), other: d.getMonth() !== month };
  });

  return createPortal(
    <div className="date-pop" role="dialog" aria-label="Выбор даты" ref={ref} style={{ top: pos?.top ?? -9999, left: pos?.left ?? 0 }} data-date-pop>
      <div className="cal-head">
        <button type="button" className="cal-nav" onClick={() => shift(-12)} aria-label="Предыдущий год">
          «
        </button>
        <button type="button" className="cal-nav" onClick={() => shift(-1)} aria-label="Предыдущий месяц">
          ‹
        </button>
        <span className="cal-title">
          {MONTHS[month]} {year}
        </span>
        <button type="button" className="cal-nav" onClick={() => shift(1)} aria-label="Следующий месяц">
          ›
        </button>
        <button type="button" className="cal-nav" onClick={() => shift(12)} aria-label="Следующий год">
          »
        </button>
      </div>
      <div className="cal-grid cal-week">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={i > 4 ? 'cal-weekend' : ''}>
            {w}
          </span>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((c) => (
          <button
            type="button"
            key={c.iso}
            className={`cal-day ${c.other ? 'cal-other' : ''} ${c.iso === value ? 'cal-selected' : ''} ${c.iso === today ? 'cal-today' : ''}`}
            onClick={() => onPick(c.iso)}
          >
            {c.day}
          </button>
        ))}
      </div>
      <div className="cal-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPick(today)}>
          Сегодня
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
          Очистить
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Поле даты на русском языке: ввод ДД.ММ.ГГГГ с маской и календарь.
 * Значение – строка ГГГГ-ММ-ДД или пустая; onValidity сообщает, введена ли дата полностью и верно.
 */
export default function DateField({
  value,
  onChange,
  onValidity,
  onBlur,
  label,
  error,
}: {
  value: string;
  onChange: (iso: string) => void;
  onValidity?: (valid: boolean, reason?: string) => void;
  onBlur?: () => void;
  label: string;
  error?: string;
}) {
  const [text, setText] = useState(isoToRu(value));
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const inputBox = useRef<HTMLDivElement>(null);

  // внешнее изменение значения обновляет текст
  useEffect(() => {
    if (ruToIso(text) !== value && !(value === '' && text !== '' && ruToIso(text) === null)) setText(isoToRu(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const valid = text === '' || ruToIso(text) !== null;
  const reason = valid ? undefined : text.length < 10 ? 'Введите дату полностью в формате ДД.ММ.ГГГГ (например, 25.12.2026)' : 'Такой даты не существует: проверьте день и месяц';
  useEffect(() => onValidity?.(valid, reason), [valid, reason, onValidity]);

  // закрытие календаря по щелчку вне поля и по Esc (не закрывая окно формы)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!box.current?.contains(t) && !t.closest('[data-date-pop]')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const pick = (iso: string) => {
    onChange(iso);
    setText(isoToRu(iso));
    setOpen(false);
  };

  return (
    <div className={`field ${error ? 'field-invalid' : ''}`} ref={box}>
      <label htmlFor={`df-${label}`}>{label}</label>
      <div className="date-field" ref={inputBox}>
        <input
          id={`df-${label}`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="ДД.ММ.ГГГГ"
          maxLength={10}
          value={text}
          onBlur={onBlur}
          aria-invalid={!!error}
          onChange={(e) => {
            const out = mask(e.target.value);
            setText(out);
            if (out === '') onChange('');
            else {
              const iso = ruToIso(out);
              if (iso) onChange(iso);
            }
          }}
        />
        <button type="button" className="icon-btn date-btn" aria-label="Открыть календарь" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          📅
        </button>
        {open && <Calendar value={value} onPick={pick} onClear={() => pick('')} onClose={() => setOpen(false)} anchor={inputBox.current} />}
      </div>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
