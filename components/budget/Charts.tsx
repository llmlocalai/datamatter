"use client";

// ---------------------------------------------------------------------------
// Formatting helpers (amounts are DOLLARS; DB was $K, already x1000 server-side).
// ---------------------------------------------------------------------------
export function fmtT(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}

export function fmtM(n: number): string {
  return `$${(n / 1e6).toFixed(1)}M`;
}

export function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

// A stable color palette (accent blue + complementary hues) for charts.
const PALETTE = [
  "#38bdf8", // accent-400
  "#818cf8", // indigo
  "#34d399", // emerald
  "#fbbf24", // amber
  "#f472b6", // pink
  "#a78bfa", // violet
  "#22d3ee", // cyan
  "#fb923c", // orange
];
export function colorAt(i: number): string {
  return PALETTE[i % PALETTE.length];
}

// ---------------------------------------------------------------------------
// TrendBars — vertical bars for the 3-year grand-total trend.
// ---------------------------------------------------------------------------
export function TrendBars({
  data,
  height = 200,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-4" style={{ height }}>
      {data.map((d, i) => {
        const h = (d.value / max) * (height - 34);
        return (
          <div key={d.label} className="flex-1 flex flex-col items-center justify-end">
            <span className="text-xs font-semibold text-navy-100 mb-1">{fmtT(d.value)}</span>
            <div
              className="w-full rounded-t-md bg-gradient-to-t from-accent-600 to-accent-400 transition-all duration-500"
              style={{ height: Math.max(h, 2) }}
            />
            <span className="text-xs text-navy-400 mt-2 font-medium">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donut — a single-value share donut (e.g. discretionary vs mandatory).
// ---------------------------------------------------------------------------
export function Donut({
  segments,
  size = 200,
  centerLabel,
  centerValue,
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2;
  const stroke = size * 0.16;
  const radius = r - stroke / 2;
  const circ = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="rotate-[-90deg]">
        <circle
          cx={r}
          cy={r}
          r={radius}
          fill="none"
          stroke="#243b53"
          strokeWidth={stroke}
        />
        {segments.map((s, i) => {
          const frac = s.value / total;
          const dash = frac * circ;
          const seg = (
            <circle
              key={i}
              cx={r}
              cy={r}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
              className="transition-all duration-500"
            />
          );
          offset += dash;
          return seg;
        })}
      </svg>
      {(centerLabel || centerValue) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {centerValue && <span className="text-xl font-bold text-navy-50">{centerValue}</span>}
          {centerLabel && <span className="text-xs text-navy-400 mt-0.5">{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MiniSpark — compact 3-point sparkline for exhibit cards.
// ---------------------------------------------------------------------------
export function MiniSpark({
  points,
  color = "#38bdf8",
  width = 120,
  height = 34,
}: {
  points: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * step;
    const y = height - 3 - ((p - min) / span) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
   });
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={coords.join(" ")} fill="none" stroke={color} strokeWidth={2} />
      {coords.map((c, i) => {
        const [x, y] = c.split(",").map(Number);
        return <circle key={i} cx={x} cy={y} r={2.5} fill={color} />;
       })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// BarList — horizontal ranked bars (by-service / by-activity).
// ---------------------------------------------------------------------------
export function BarList({
  items,
  valueFmt = fmtT,
}: {
  items: { label: string; value: number; pct?: number }[];
  valueFmt?: (n: number) => string;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-2.5">
      {items.map((it, i) => (
        <div key={it.label + i} className="group">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-navy-100 font-medium truncate pr-3">{it.label}</span>
            <span className="text-navy-50 font-semibold tabular-nums">
              {valueFmt(it.value)}
              {it.pct != null && (
                <span className="text-navy-400 ml-2 text-xs">{it.pct.toFixed(1)}%</span>
              )}
            </span>
          </div>
          <div className="w-full bg-navy-800 rounded-full h-2">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-accent-500 to-accent-400 transition-all duration-500"
              style={{ width: `${(it.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
