import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar } from '@/components/Provenance';
import { DataTable } from '@/components/charts';
import { fmtB, fmtInt, fmtPct } from '@/components/format';
import RawTable from '@/components/raw/RawTable';
import { getProvenance, isLoaded } from '@/lib/analytics';
import { getRawSources, getRawControl, type RawSource } from '@/lib/raw';
import { getSplitByFy, splitReady } from '@/lib/funding';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'Raw data · datamatter',
  description: 'The first five records of every file behind this site — File A, File B, File C, FPDS contract and assistance transactions, the President’s Budget exhibit workbooks and the submission calendar — with every column, as the files hold them.',
};
export const revalidate = 900;

const DR_FIELD = 'direct_or_reimbursable_funding_source';

/** What the site does with each file's direct/reimbursable attribute, or with its absence. */
const DR_USE: Record<string, string> = {
  file_a: 'No direct/reimbursable column. Budgetary resources, obligations and outlays here are direct and reimbursable together, so the site takes direct amounts from File B and uses File A totals only for the Statement of Budgetary Resources and the File A–File B tie-out. The direct rate divides File B direct obligations by File A resources less spending authority from offsetting collections.',
  file_b: 'D or R on every row. Execution figures default to D; R is shown beside them and never added in, because a reimbursable order from another Department account is already that account’s direct obligation.',
  file_c_contracts: 'Carries the flag, but the award linkage compares File C with FPDS, which does not. Both sides of that comparison stay direct and reimbursable together so the two are measured on the same basis.',
  contracts: 'No such column. FPDS records the contract action, not the authority that funds it — a Working Capital Fund contract paid from customer orders looks the same as one paid from an appropriation.',
};

function RecordsBlock({ s }: { s: RawSource }) {
  const rowsLabel = s.fileFormat === 'parquet'
    ? `${fmtInt(s.totalRows ?? 0)} rows in ${fmtInt(s.fileCount ?? 0)} file${s.fileCount === 1 ? '' : 's'}`
    : s.fileFormat === 'xlsx' ? `${fmtInt(s.totalRows ?? 0)} data rows on this sheet`
      : `${fmtInt(s.totalRows ?? 0)} records returned`;
  const dr = s.columns.some((c) => c.name === DR_FIELD);
  return (
    <article id={s.sourceKey} className="glass-card rounded-lg p-4 sm:p-5 scroll-mt-20">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <h3 className="text-navy-50 font-semibold">{s.label}</h3>
        <div className="flex flex-wrap gap-1.5 text-[12px] font-mono">
          <span className="px-2 py-0.5 rounded bg-navy-800 text-accent-400 uppercase">{s.fileFormat}</span>
          <span className="px-2 py-0.5 rounded bg-navy-800 text-navy-200">{s.columnCount} columns</span>
          <span className="px-2 py-0.5 rounded bg-navy-800 text-navy-200">{rowsLabel}</span>
          {(s.sourceKey.startsWith('file_') || s.sourceKey === 'contracts') && (
            <span className={`px-2 py-0.5 rounded ${dr ? 'bg-navy-700 text-accent-400' : 'bg-navy-800 text-navy-400'}`}>
              {dr ? 'has direct/reimbursable' : 'no direct/reimbursable'}
            </span>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xs mb-3">
        <div className="min-w-0">
          <dt className="text-navy-500 uppercase tracking-wider text-[12px] font-semibold">File</dt>
          <dd className="text-navy-200 mt-0.5 font-mono text-[12px] break-all">{s.filePath}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-navy-500 uppercase tracking-wider text-[12px] font-semibold">Records below are from</dt>
          <dd className="text-navy-200 mt-0.5 font-mono text-[12px] break-all">
            {s.samplePath}{s.sheetName ? ` · sheet “${s.sheetName}”` : ''}
          </dd>
        </div>
      </dl>
      {s.note && <p className="text-xs text-navy-400 leading-relaxed mb-4 max-w-4xl">{s.note}</p>}

      {s.preamble.length > 0 && (
        <details className="mb-4">
          <summary className="cursor-pointer text-[12px] text-navy-400 hover:text-navy-200">
            {s.preamble.length} row{s.preamble.length === 1 ? '' : 's'} printed above the header, as filed
          </summary>
          <div className="scroll-x rounded border border-navy-800 mt-2">
            <table className="text-[12px] font-mono border-collapse">
              <tbody>
                {s.preamble.map((r, i) => (
                  <tr key={i} className="border-t border-navy-800/70 first:border-0">
                    {r.map((v, j) => (
                      <td key={j} className="px-3 py-1.5 text-navy-300 whitespace-pre-wrap min-w-[4rem]">
                        {v === null ? <span className="italic text-navy-500">null</span> : v === '' ? <span className="text-navy-500">""</span> : v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {s.records.length
        ? <RawTable columns={s.columns} records={s.records} highlight={[DR_FIELD]} />
        : <p className="text-sm text-amber-200">No records were sampled from this file.</p>}
    </article>
  );
}

export default async function RawDataPage() {
  const [loaded, prov, sources, control, ready] = await Promise.all([
    isLoaded(), getProvenance('raw_samples'), getRawSources(), getRawControl(), splitReady().catch(() => false),
  ]);
  if (!loaded) return <Shell><NotLoaded /></Shell>;
  const split = ready ? await getSplitByFy() : [];

  const groups: { label: string; items: RawSource[] }[] = [];
  for (const s of sources) {
    let g = groups.find((x) => x.label === s.groupLabel);
    if (!g) groups.push(g = { label: s.groupLabel, items: [] });
    g.items.push(s);
  }
  const records = sources.reduce((n, s) => n + s.records.length, 0);
  const columns = sources.reduce((n, s) => n + s.columnCount, 0);
  const drRows = ['file_a', 'file_b', 'file_c_contracts', 'contracts']
    .map((k) => sources.find((s) => s.sourceKey === k)).filter(Boolean) as RawSource[];

  return (
    <Shell>
      <PageHeader
        eyebrow="Method"
        title="Raw data"
        lede="Every file behind the figures on this site, before anything is done to it: the first five records of each, with every column the file carries, under the file’s own names and in its own order. Values are shown as the file holds them — nothing is renamed, scoped, rounded or summed."
      />

      <div className="pt-6 space-y-4">
        <ProvenanceBar p={prov} extra="These records are a sample for reading the files, not a figure. Every total on the site is computed from the whole file and carries its own source and vintage." />
        {control.length > 0 && (
          <ul className="space-y-1.5">
            {control.map((c, i) => (
              <li key={i} className="flex gap-2 text-xs leading-relaxed">
                <span className={`shrink-0 font-mono font-semibold uppercase ${c.status === 'pass' ? 'text-[color:var(--status-good)]' : 'text-[color:var(--status-critical)]'}`}>
                  RAW-01 {c.status}
                </span>
                <span className="text-navy-300">{c.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!sources.length ? (
        <Section title="No raw samples in this load">
          <p className="text-sm text-amber-200 max-w-2xl leading-relaxed">
            The raw samples have not been extracted into this database. Run{' '}
            <code className="font-mono text-accent-400">npm run migrate</code>, then{' '}
            <code className="font-mono text-accent-400">npm run refresh</code> (the extract’s{' '}
            <code className="font-mono">--step raw</code> is part of <code className="font-mono">--step all</code>).
            Nothing is shown rather than an old sample.
          </p>
        </Section>
      ) : (
        <>
          <Section title="Files on this page"
            note={`${sources.length} files, ${fmtInt(columns)} columns, ${records} records. Parquet samples come from the newest fiscal-year partition (award files: the newest vintage and fiscal year); workbooks from their first sheet.`}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {groups.map((g) => (
                <nav key={g.label} aria-label={g.label} className="glass-card rounded-lg p-4">
                  <h3 className="text-[12px] uppercase tracking-wider text-navy-500 font-semibold mb-2">{g.label}</h3>
                  <ul className={g.items.length > 8 ? 'grid grid-cols-2 gap-x-3 gap-y-1' : 'space-y-1'}>
                    {g.items.map((s) => (
                      <li key={s.sourceKey} className="text-[13px] leading-snug">
                        <a href={`#${s.sourceKey}`} className="text-navy-200 hover:text-accent-400 hover:underline">{s.label}</a>
                        <span className="text-navy-500 text-[12px] font-mono"> · {s.columnCount}</span>
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
          </Section>

          {drRows.length > 0 && (
            <Section title="Direct or reimbursable: which files say"
              note="The attribute that separates the Department’s own execution from work it performs for a paying customer is a column in some of these files and absent from others. It is read from the column lists below, not asserted.">
              <DataTable
                head={['File', `Carries ${DR_FIELD}`, 'What the site does with it']}
                align={[1, 2]}
                rows={drRows.map((s) => {
                  const idx = s.columns.findIndex((c) => c.name === DR_FIELD);
                  const vals = idx >= 0 ? Array.from(new Set(s.records.map((r) => r[idx]).filter((v) => v !== null))) : [];
                  return [
                    <a key="l" href={`#${s.sourceKey}`} className="text-navy-100 hover:text-accent-400 hover:underline">{s.label}</a>,
                    <span key="h" className={idx >= 0 ? 'text-accent-400 font-mono text-[12px]' : 'text-navy-400 font-mono text-[12px]'}>
                      {idx >= 0 ? `yes — column ${idx + 1} of ${s.columnCount}${vals.length ? `; sample values ${vals.join(', ')}` : ''}` : `no — none of its ${s.columnCount} columns`}
                    </span>,
                    <span key="u" className="block max-w-xl whitespace-normal text-navy-300 leading-relaxed">{DR_USE[s.sourceKey] ?? ''}</span>,
                  ];
                })}
              />
              {split.length > 0 && (
                <p className="text-xs text-navy-400 mt-4 max-w-3xl leading-relaxed">
                  In the current load, reimbursable File B obligations are{' '}
                  {split.slice(-2).map((y, i) => (
                    <span key={y.fiscalYear}>
                      {i > 0 ? ' and ' : ''}
                      <span className="text-navy-100 tnum">{fmtB(y.reimbursable)}</span> of{' '}
                      <span className="tnum">{fmtB(y.obligationsB)}</span> in FY{y.fiscalYear}
                      {' '}({fmtPct(y.reimbursable / Math.max(1, y.obligationsB) * 100)}, {y.submissionPeriod})
                    </span>
                  ))}
                  {' '}— the amount a direct-plus-reimbursable total would overstate the Department’s own execution by. See{' '}
                  <Link href="/execution#program-year" className="text-accent-400 hover:underline">Budget to execution</Link> and control{' '}
                  <Link href="/controls" className="text-accent-400 hover:underline">DR-01</Link>.
                </p>
              )}
            </Section>
          )}

          {groups.map((g) => (
            <Section key={g.label} title={g.label}>
              <div className="space-y-6">
                {g.items.map((s) => <RecordsBlock key={s.sourceKey} s={s} />)}
              </div>
            </Section>
          ))}
        </>
      )}
    </Shell>
  );
}
