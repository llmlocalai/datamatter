import type { Metadata } from 'next';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, BarList, DataTable } from '@/components/charts';
import { fmtInt, fmtPct } from '@/components/format';
import { getKbInventory, getHearingSummary, getProvenance } from '@/lib/analytics';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'Congressional direction · datamatter',
  description: 'The congressional direction corpus: committee reports, joint explanatory statements, prints, and the hearing record.',
};
export const revalidate = 900;

export default async function CongressionalPage() {
  const [inventory, detail, hearings, prov] = await Promise.all([
    getKbInventory('congressional'), getKbInventory('congressional_detail'),
    getHearingSummary(), getProvenance('knowledge_bank'),
  ]);
  if (!detail.length && !hearings.totals.total) return <Shell><NotLoaded /></Shell>;

  const totalDocs = detail.reduce((s, d) => s + d.docCount, 0);
  const byCongress = Object.values(
    hearings.byCongress.reduce((acc: Record<number, { congress: number; total: number; defense: number }>, r) => {
      acc[r.congress] = acc[r.congress] ?? { congress: r.congress, total: 0, defense: 0 };
      acc[r.congress].total += r.total; acc[r.congress].defense += r.defense;
      return acc;
    }, {})).sort((a, b) => b.congress - a.congress);

  return (
    <Shell>
      <PageHeader
        eyebrow="Oversight · congressional direction"
        title="Congressional direction"
        lede="Report language is not statute, but it is operationally binding on execution. This is what the corpus contains — committee reports, joint explanatory statements, prints, mandated reports, and the hearing record."
      />

      <div className="mt-6">
        <ProvenanceBar p={prov}
          extra="Hearing dates in the source filenames are acquisition dates, not the dates hearings were held. They are labelled as ingest dates throughout and no hearing on this page is described as upcoming." />
      </div>

      <Section title="The corpus">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Congressional direction documents" value={fmtInt(totalDocs)}
            sub={`Across ${detail.length} document classes`} tone="accent" />
          <StatTile label="Hearing records" value={fmtInt(hearings.totals.total)}
            sub="Parsed from GPO hearing identifiers" />
          <StatTile label="Defense-related hearings" value={fmtInt(hearings.totals.defense)}
            sub={`${fmtPct(hearings.totals.defense / Math.max(1, hearings.totals.total) * 100)} of the hearing record`} />
          <StatTile label="Congresses represented" value={String(byCongress.length)}
            sub={byCongress.map((c) => c.congress).join(', ')} />
        </div>
      </Section>

      <Section title="Documents by class"
        note="Armed Services and Appropriations committee reports are where execution-relevant direction actually lands.">
        <BarList
          format="int"
          rows={detail.map((d) => ({ key: d.folder, label: d.label, value: d.docCount }))}
        />
      </Section>

      <Section title="Hearing record by Congress"
        note="Counts of hearing documents held, and how many carry defense-relevant subject matter in their title.">
        <DataTable
          head={['Congress', 'Hearing records held', 'Defense-related', 'Share']}
          rows={byCongress.map((c) => [
            `${c.congress}th`, fmtInt(c.total), fmtInt(c.defense),
            fmtPct(c.defense / Math.max(1, c.total) * 100),
          ])}
        />
        <Caveat>
          The previous version of this page showed twelve cards under &ldquo;Upcoming Testimonies&rdquo;. All
          twelve carried the same date — the acquisition date embedded in the filename — a chamber name where a
          committee belonged, a hardcoded witness count of one, and titles that were mostly not defense
          subject matter, because the extract sorted 1,092 hearings by a constant and took the first twelve.
          Hearing dates are not available in this corpus, so no hearing date is published; what is published
          is what the corpus can support.
        </Caveat>
      </Section>

      <Section title="Defense-related hearing records"
        note="Titles matched on defense subject matter. Listed as records held, in identifier order — not as a schedule.">
        <DataTable
          head={['Hearing identifier', 'Congress', 'Chamber', 'Title', 'Ingested']}
          rows={hearings.recent.map((h) => [
            h.hearingId, `${h.congress}th`, h.chamber,
            h.title.length > 70 ? h.title.slice(0, 70) + '…' : h.title,
            h.ingestDate ?? '—',
          ])}
          caption="Ingested is the date the document entered the knowledge bank. It is not the hearing date, and is labelled that way everywhere it appears."
        />
      </Section>
    </Shell>
  );
}
