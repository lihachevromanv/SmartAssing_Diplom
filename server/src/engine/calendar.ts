/** Рабочих дней в неделе принято равным пяти. */
export const WORK_DAYS_PER_WEEK = 5;

const DAY_MS = 24 * 3600 * 1000;

/** Число рабочих дней в интервале (from, to]; для to <= from возвращает 0. Дробная часть текущего дня не учитывается. */
export function workingDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  let days = 0;
  for (let d = new Date(start.getTime() + DAY_MS); d <= end; d = new Date(d.getTime() + DAY_MS)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days++;
  }
  return days;
}

/** Дата, наступающая через заданное (дробное) число рабочих дней после from. */
export function addWorkingDays(from: Date, days: number): Date {
  let whole = Math.floor(days);
  const frac = days - whole;
  let d = new Date(from.getTime());
  while (whole > 0) {
    d = new Date(d.getTime() + DAY_MS);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) whole--;
  }
  return new Date(d.getTime() + frac * DAY_MS);
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
