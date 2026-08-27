import type { Metadata } from 'next';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, BarList, DataTable } from '@/components/charts';
import { fmtInt } from '@/components/format';
import { getJustificationExhibits, getProvenance, getKbInventory } from '@/lib/analytics';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'Budget justification · datamatter',
  description: 'The FY2027 justification book inventory by budget activity, from the DoD-FM knowledge bank.',
};
export const revalidate = 900;

export default async function JustificationPage() {
  const [exhibits, prov, reg] = await Promise.all([
    getJustificationExhibits(), getProvenance('knowledge_bank'), getKbInventory('justification'),
  ]);
  if (!exhibits.length) return <Shell><NotLoaded /></Shell>;
  const total = exhibits.reduce((s, e) => s + e.exhibitCount, 0);

  return (
    <Shell>
      <PageHeader
        eyebrow="Formulation · justification material"
        title="Budget justification inventory"
        lede="What justification material exists for the FY2027 request, by budget activity. This is a count of exhibits held — it is deliberately not a quality score, because nothing here reads the content of a justification."
      />

      <div className="mt-6"><ProvenanceBar p={prov} /></div>

      <Section title="FY2027 justification books">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile label="Justification exhibits held" value={fmtInt(total)}
            sub={`Across ${exhibits.length} budget activities`} tone="accent" />
          <StatTile label="Budget activities covered" value={String(exhibits.length)}
            sub="Top-level J-book categories present in the knowledge bank" />
          <StatTile label="Largest activity" value={exhibits[0]?.activity ?? '—'}
            sub={`${fmtInt(exhibits[0]?.exhibitCount ?? 0)} exhibits`} />
        </div>
      </Section>

      <Section title="Exhibits per budget activity"
        note="Read this as coverage of the justification corpus, nothing more.">
        <BarList
          format="int"
          rows={exhibits.map((e) => ({
            key: e.activity, label: e.activity, value: e.exhibitCount,
            meta: `${((e.exhibitCount / total) * 100).toFixed(1)}% of the FY2027 justification corpus held`,
          }))}
        />
        <Caveat>
          The prior version of this page bucketed these same folder counts into &ldquo;High quality&rdquo;,
          &ldquo;Medium quality&rdquo; and &ldquo;Low quality&rdquo; — an activity with five or more PDFs was
          captioned &ldquo;clear, data-driven justifications&rdquo;. No justification text was read then and
          none is read now, so the display says what it measures: how many exhibits are held. It also
          displayed an &ldquo;OMB Circular A-30&rdquo; compliance section. There is no OMB Circular A-30; the
          budget circular is A-11, internal control is A-123, and financial reporting is A-136.
        </Caveat>
      </Section>

      <Section title="Where the request itself is analysed"
        note="The exhibits' contents — seven '-1' display tables, de-duplicated to their canonical sheets and loaded line by line — drive the FY2027 dashboard.">
        <DataTable
          head={['Collection', 'Documents held']}
          rows={reg.map((r) => [r.label, fmtInt(r.docCount)])}
          caption="For the request figures themselves, see the FY2027 budget dashboard; for how the request becomes obligations, see Budget to execution."
        />
      </Section>
    </Shell>
  );
}
