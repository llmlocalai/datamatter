import type { Metadata } from 'next';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar } from '@/components/Provenance';
import { getDefinitions, getProvenance } from '@/lib/analytics';
import DefinitionBrowser from './Browser';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'Definitions · datamatter',
  description: 'Financial-management terms used on this site, each with its authoritative source. One meaning per term, site-wide.',
};
export const revalidate = 900;

export default async function DefinitionsPage() {
  const [defs, prov] = await Promise.all([getDefinitions(), getProvenance('knowledge_bank')]);
  if (!defs.length) return <Shell><NotLoaded /></Shell>;
  return (
    <Shell>
      <PageHeader
        eyebrow="Method"
        title="Definitions"
        lede="Consistent definitions are a precondition for interoperable output, so they are a published artifact here rather than an assumption. Every term carries the authority it comes from; where this site uses a term in a KPI, this is the meaning it uses."
      />
      <div className="mt-6"><ProvenanceBar p={prov} /></div>
      <Section title={`${defs.length} terms`}
        note="Filter by topic or search. Terms without a named authority would fail control DEF-01 and are not published.">
        <DefinitionBrowser defs={defs} />
      </Section>
    </Shell>
  );
}
