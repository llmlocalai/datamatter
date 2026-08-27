import type { Metadata } from 'next';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { getAllProvenance, getKbInventory } from '@/lib/analytics';
import { DataTable } from '@/components/charts';
import { fmtInt } from '@/components/format';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'Sources and methods · datamatter',
  description: 'Every dataset behind this site: authoritative source, grain, vintage, transformation, refresh cadence, and stated limitations.',
};
export const revalidate = 900;

export default async function SourcesPage() {
  const [datasets, inventory] = await Promise.all([getAllProvenance(), getKbInventory()]);
  if (!datasets.some((d) => d.vintage)) return <Shell><NotLoaded /></Shell>;
  const kb = inventory.filter((i) => i.collection !== 'congressional_detail');

  return (
    <Shell>
      <PageHeader
        eyebrow="Method"
        title="Sources and methods"
        lede="One row per dataset. If a figure appears anywhere on this site, the dataset it came from is listed here with the extraction that produced it and the limitation that constrains how it may be read."
      />

      <Section title="Data register">
        <div className="space-y-5">
          {datasets.map((d: any) => (
            <article key={d.datasetKey} className="glass-card rounded-lg p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
                <h3 className="text-navy-50 font-semibold">{d.label}</h3>
                {d.vintage ? (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-navy-800 text-accent-400">
                    vintage {d.vintage} · {fmtInt(d.rowCount ?? 0)} rows
                  </span>
                ) : (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300">
                    not loaded
                  </span>
                )}
              </div>
              <p className="text-sm text-navy-300 leading-relaxed mb-4 max-w-3xl">{d.description}</p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 text-xs">
                {[['Source system', d.sourceSystem], ['Grain', d.grain],
                  ['Path', d.sourcePath], ['Refresh', d.refreshCadence]].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-navy-500 uppercase tracking-wider text-[10px] font-semibold">{k}</dt>
                    <dd className="text-navy-200 mt-0.5 font-mono text-[11px] break-words">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-amber-200/70 mt-4 border-l-2 border-amber-500/30 pl-3 leading-relaxed">
                <strong className="text-amber-200 font-semibold">Limitations. </strong>{d.limitations}
              </p>
            </article>
          ))}
        </div>
      </Section>

      <Section title="How a figure gets here"
        note="Four stages, each of which can fail loudly. Nothing is hand-edited at any point; a wrong number is fixed by fixing the extract and re-running.">
        <ol className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            ['Extract', 'scripts/etl_analytics.py reads the parquet warehouse and the knowledge bank directly and writes a staged payload stamped with its vintage and extraction time.'],
            ['Load', 'scripts/load_analytics.js opens a dm_load row, inserts the measures against it, and marks the prior load superseded — all inside one transaction.'],
            ['Control', 'The control suite runs against the loaded data before the transaction commits. A critical failure rolls the whole load back and the previous vintage stays published.'],
            ['Serve', 'Pages read only through the data layer, which joins every measure to its load row. A figure without provenance cannot be returned by construction.'],
          ].map(([h, b], i) => (
            <li key={h} className="glass-card rounded-lg p-4">
              <span className="text-[11px] font-mono text-accent-400">0{i + 1}</span>
              <h3 className="text-navy-100 font-semibold text-sm mt-1.5">{h}</h3>
              <p className="text-xs text-navy-400 mt-1.5 leading-relaxed">{b}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Knowledge bank inventory"
        note="Document counts by collection. These are counts of files that exist, and are labelled as such — a document is not a finding, and a folder is not an assessment.">
        <DataTable
          head={['Collection', 'Folder', 'Documents', 'Authority tier']}
          rows={kb.map((i) => [i.label, i.folder, fmtInt(i.docCount),
            i.authorityTier === 1 ? 'primary' : i.authorityTier === 2 ? 'secondary' : '—'])}
          caption="Authority tier drives ranking in regulatory search: statute and enacted appropriations outrank regulation, which outranks secondary summaries."
        />
      </Section>

      <Section title="Naming"
        note="Why this site says Department of War in framing and DoD in data fields.">
        <p className="text-sm text-navy-300 leading-relaxed max-w-3xl">
          The FY2025 Agency Financial Report presents the Department under the{' '}
          <strong className="text-navy-100">Department of War</strong> designation per Executive Order 14347,
          and the position this work is aimed at uses that name. The underlying data does not: USASpending,
          FPDS, and the Treasury account structure all carry <strong className="text-navy-100">DoD</strong>{' '}
          nomenclature and agency code 097. Framing therefore uses Department of War; anything that names an
          actual field, code, or source system keeps the name that source uses. Mixing the two silently would
          be the error — stating the convention is the fix.
        </p>
      </Section>
    </Shell>
  );
}
