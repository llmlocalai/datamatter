/**
 * Which fiscal year a page opens on.
 *
 * The answer is the year the calendar is in, not the last one that closed. Every
 * page here used to default to the newest CLOSED year, which on 10 September
 * 2026 opened the site on FY2025 and made the year actually being executed
 * something the reader had to go and find. A year in progress is harder to
 * present — every figure on it is period-to-date and has to say so — but it is
 * the year the question is about.
 *
 * The rule lives here rather than in each page so that "current" means one thing
 * site-wide, and so the fallback when the extract does not reach the current
 * year is the same everywhere: the newest year it does reach.
 */

/** The fiscal year a date falls in. October starts the next one. */
export function fiscalYearOf(d: Date = new Date()): number {
  return d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}

/** Day of the fiscal year, 1 = 1 October. */
export function dayOfFiscalYear(d: Date, fy: number): number {
  const start = Date.UTC(fy - 1, 9, 1);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((day - start) / 86400000) + 1;
}

/** Whole days from `d` to 30 September of its fiscal year, floored at zero. */
export function daysToFiscalYearEnd(d: Date = new Date(), fy = fiscalYearOf(d)): number {
  const end = Date.UTC(fy, 8, 30);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.max(0, Math.round((end - day) / 86400000));
}

/**
 * The row a page should open on: the one the reader asked for, else the current
 * fiscal year, else the newest the extract holds.
 */
export function pickFiscalYear<T extends { fiscalYear: number }>(
  rows: T[], requested?: string | number | null, now: Date = new Date(),
): T | undefined {
  if (!rows.length) return undefined;
  const asked = Number(requested);
  const exact = Number.isFinite(asked) ? rows.find((r) => r.fiscalYear === asked) : undefined;
  if (exact) return exact;
  const current = rows.find((r) => r.fiscalYear === fiscalYearOf(now));
  if (current) return current;
  return rows.reduce((a, b) => (b.fiscalYear > a.fiscalYear ? b : a));
}
