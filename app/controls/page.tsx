import type { Metadata } from 'next';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { StatTile } from '@/components/charts';
import { getControls } from '@/lib/analytics';
import { fmtPct } from '@/components/format';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'Controls · datamatter',
  description: 'Validation rules over the published data, expressed as internal control over reporting, with their latest results.',
};
export const revalidate = 900;

const STATUS = {
  pass: { label: 'Pass', cls: 'text-[color:var(--status-good)] border-[color:var(--status-good)]', icon: '✓' },
  fail: { label: 'Fail', cls: 'text-[color:var(--status-critical)] border-[color:var(--status-critical)]', icon: '✕' },
  warn: { label: 'Warn', cls: 'text-[color:var(--status-warning)] border-[color:var(--status-warning)]', icon: '!' },
  not_applicable: { label: 'N/A', cls: 'text-navy-500 border-navy-600', icon: '–' },
} as const;

function Badge({ status }: { status: string }) {
  const s = STATUS[status as keyof typeof STATUS] ?? STATUS.not_applicable;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>{s.label}
    </span>
  );
}

export default async function ControlsPage() {
  const controls = await getControls();
  if (!controls.some((c) => c.total)) return <Shell><NotLoaded /></Shell>;
  const assertions = controls.reduce((s, c) => s + c.total, 0);
  const passed = controls.reduce((s, c) => s + c.pass, 0);
  const failed = controls.reduce((s, c) => s + c.fail, 0);
  const runAt = controls.find((c) => c.runAt)?.runAt ?? null;

  return (
    <Shell>
      <PageHeader
        eyebrow="Method"
        title="Control over reporting"
        lede="These are the validation rules the data must satisfy before it is published. They run inside the load transaction, not in a test suite nobody blocks on: a critical failure rolls the load back and the previous vintage stays live."
      />

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatTile label="Assertions evaluated" value={String(assertions)}
          sub={runAt ? `Last run ${runAt.slice(0, 16).replace('T', ' ')}` : undefined} />
        <StatTile label="Passing" value={String(passed)} tone="good"
          sub={fmtPct(passed / Math.max(1, assertions) * 100) + ' of assertions'} />
        <StatTile label="Failing" value={String(failed)} tone={failed ? 'warning' : 'good'}
          sub={failed ? 'Published as findings, not suppressed' : 'No open findings'} />
        <StatTile label="Controls defined" value={String(controls.length)}
          sub="Each names its assertion, rationale and authority" />
      </div>

      <Section title="The control suite"
        note="Severity determines what a failure does. Critical means the extract is unusable and the load is refused. High and moderate mean the finding is published alongside the data it concerns.">
        <div className="space-y-4">
          {controls.map((c) => {
            const worst = c.fail ? 'fail' : c.warn ? 'warn' : c.total ? 'pass' : 'not_applicable';
            return (
              <article key={c.code} className="glass-card rounded-lg overflow-hidden">
                <div className="p-5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 mb-3">
                    <code className="text-[11px] font-mono font-semibold text-accent-400">{c.code}</code>
                    <h3 className="text-navy-50 font-semibold flex-1 min-w-[12rem]">{c.name}</h3>
                    <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${
                      c.severity === 'critical' ? 'text-[color:var(--status-critical)] border-[color:var(--status-critical)]'
                      : c.severity === 'high' ? 'text-[color:var(--status-serious)] border-[color:var(--status-serious)]'
                      : 'text-navy-400 border-navy-600'}`}>
                      {c.severity}{c.severity === 'critical' ? ' · blocks load' : ''}
                    </span>
                    <Badge status={worst} />
                    <span className="text-[11px] text-navy-400 tnum">{c.pass}/{c.total} pass</span>
                  </div>
                  <p className="text-sm text-navy-200 leading-relaxed"><strong className="text-navy-400 font-medium">Asserts. </strong>{c.assertion}</p>
                  <p className="text-sm text-navy-400 leading-relaxed mt-2"><strong className="text-navy-500 font-medium">Why. </strong>{c.rationale}</p>
                  {c.authority && (
                    <p className="text-xs text-navy-500 mt-2 font-mono">Authority · {c.authority}</p>
                  )}
                </div>
                {c.results.length > 0 && (
                  <div className="border-t border-navy-800/70 bg-navy-950/40 divide-y divide-navy-800/50">
                    {c.results.map((r, i) => (
                      <div key={i} className="px-5 py-2.5 flex items-start gap-3 text-xs">
                        <Badge status={r.status} />
                        <span className={r.status === 'fail' ? 'text-navy-200' : 'text-navy-400'}>{r.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </Section>
    </Shell>
  );
}
