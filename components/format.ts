/** Shared number formatting. Every money figure on the site goes through here. */
export const fmtT = (n: number) =>
  Math.abs(n) >= 1e12 ? `$${(n / 1e12).toFixed(2)}T`
  : Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(1)}B`
  : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M`
  : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

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
