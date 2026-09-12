import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader } from '@/components/Shell';
import AskBox from '@/components/chat/AskBox';

export const metadata: Metadata = {
  title: 'Ask the corpus · datamatter',
  description:
    'Ask the local models about the justification books, the execution chain and the controls — '
    + 'retrieved against this site’s own corpus first, with every source listed and every '
    + 'answer naming the model that wrote it.',
};
export const dynamic = 'force-dynamic';

export default function AskPage() {
  return (
    <Shell>
      <PageHeader
        eyebrow="Ask · local models, this site’s corpus"
        title={<>Ask the <span className="text-accent-400">corpus</span></>}
        lede="The same chat as the front page, given the whole window. Questions are retrieved against the justification books' own text, the measures this site publishes, its controls and its defined terms before a model sees them — so an answer can be followed back to a page, a book and a page number rather than taken on trust."
      />
      <div className="mt-6 mb-10">
        <AskBox variant="page" />
      </div>
      <p className="text-[12px] text-navy-500 pb-10">
        What the models are and how they are reached:{' '}
        <Link href="/sources" className="text-accent-400 hover:underline">sources</Link>
        {' '}· the books themselves:{' '}
        <Link href="/jbook" className="text-accent-400 hover:underline">justification books</Link>
        {' '}· the passage search that needs no model:{' '}
        <Link href="/regulation" className="text-accent-400 hover:underline">regulatory search</Link>
      </p>
    </Shell>
  );
}
