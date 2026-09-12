import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';

/**
 * A segment-level boundary rather than the site's root one.
 *
 * With only the root `app/not-found.tsx`, Next 14 renders the right page for a
 * missing case but answers 200, so a monitor watching status codes is told a
 * missing record is fine. Giving the segment its own boundary restores the 404.
 */
export default function CaseNotFound() {
  return (
    <Shell>
      <PageHeader
        eyebrow="SBR assurance"
        title="No such case"
        lede="This case key is not in the current load. A case exists only while the load that produced it is current, so a key from an older extract, or from a fiscal year whose exceptions have since cleared, will not resolve here."
      />
      <Section title="">
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/sbr" className="text-accent-400 hover:text-accent-300">The case queue &rarr;</Link>
          <Link href="/nfr/budgetary" className="text-navy-400 hover:text-accent-400">
            The material weakness this programme works on &rarr;
          </Link>
        </div>
      </Section>
    </Shell>
  );
}
