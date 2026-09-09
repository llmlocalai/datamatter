/** Shared number formatting. Every money figure on the site goes through here. */
/* The sign goes outside the currency mark. "$-549.0M" reads as a dollar amount
   of minus-549 million; "−$549.0M" reads as a subtraction, which is what a
   "Less: Advance Procurement (PY)" row actually is. */
export const fmtT = (n: number) => {
  const a = Math.abs(n), sign = n < 0 ? '−' : '';
  return a >= 1e12 ? `${sign}$${(a / 1e12).toFixed(2)}T`
    : a >= 1e9 ? `${sign}$${(a / 1e9).toFixed(1)}B`
    : a >= 1e6 ? `${sign}$${(a / 1e6).toFixed(1)}M`
    : `${sign}$${a.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

export const fmtB = (n: number) => `$${(n / 1e9).toFixed(1)}B`;
export const fmtM = (n: number) => `$${(n / 1e6).toFixed(1)}M`;
export const fmtSignedM = (n: number) =>
  `${n >= 0 ? '+' : '−'}$${Math.abs(n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
export const fmtInt = (n: number) => n.toLocaleString('en-US');
export const fmtPct = (n: number, d = 1) => `${n.toFixed(d)}%`;
export const fmtCount = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n);

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)',
                       'var(--series-4)', 'var(--series-5)'];
