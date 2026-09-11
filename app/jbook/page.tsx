import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, DataTable } from '@/components/charts';
import { fmtInt } from '@/components/format';
import { getProvenance, isLoaded } from '@/lib/analytics';
import {
  getLexicon, getBookFunds, getBooks, getLatestPbYear, getStyleProfiles, booksReady,
} from '@/lib/jbook';
import { llmStatus } from '@/lib/llm';
import { NotLoaded } from '../execution/page';
import JBookStudio from '@/components/jbook/JBookStudio';
import LexiconAdd from '@/components/jbook/LexiconAdd';

export const metadata: Metadata = {
  title: 'Justification book · datamatter',
  description:
    'Every justification book in the archive, each one held as itself: its own sections, its own '
    + 'word bands, its own format drift across up to twenty-nine President’s Budgets. Pick a '
    + 'book, see what its editions actually do, then write the next one against it — with a '
    + 'screen that will not let an internal deliberative reference reach a page bound for Congress.',
};
export const revalidate = 900;

export default async function JBookPage() {
  if (!(await isLoaded())) return <Shell><NotLoaded /></Shell>;

  // The book grain may be ahead of the database on a deploy that landed before
  // its migration or its load. Withhold the page rather than fail the build.
  if (!(await booksReady())) return <Shell><NotLoaded /></Shell>;

  const [prov, funds, lexicon, latestPb] = await Promise.all([
    getProvenance('jbook_corpus'), getBookFunds(), getLexicon(), getLatestPbYear(),
  ]);
  if (!prov || !funds.length) return <Shell><NotLoaded /></Shell>;

  const initialFund = funds[0].fundKey;
  const [initialBooks, styles, llm] = await Promise.all([
    getBooks({ fund: initialFund, limit: 400 }), getStyleProfiles(), llmStatus(),
  ]);

  const books = funds.reduce((s, f) => s + Number(f.books), 0);
  const editions = funds.reduce((s, f) => s + Number(f.editions), 0);
  const current = funds.reduce((s, f) => s + Number(f.current), 0);
  const oldest = Math.min(...funds.map((f) => f.firstPbYear));
  const blocking = lexicon.filter((l) => l.severity === 'block').length;
  const authoringOpen = !!process.env.JBOOK_TOKEN;

  return (
    <Shell>
      <PageHeader
        eyebrow="Justification · one book at a time"
        title={<>Every book, held as <span className="text-accent-400">itself</span></>}
        lede="A justification book is not a genre, it is a specific document with a specific history. This page reads every book in the archive — O&amp;M, procurement, RDT&amp;E, military construction, BRAC, family housing, the working capital fund, the health program — and keeps each one as its own identity across its own editions, because the sections a book prints, the length it runs them to and the year it stopped printing one are facts about that book and no other. Choose one, then write the next edition against what it actually does."
      />

      <div className="mt-6"><ProvenanceBar p={prov}
        extra={`Structure and measurements are read from ${editions.toLocaleString()} editions across `
          + `${books.toLocaleString()} books, PB${oldest} to PB${latestPb ?? ''}. Example text is held `
          + `for a book's two most recent editions only. What you write is stored in tables of its own `
          + `that no data refresh touches.`} /></div>

      <Section title="What has been read"
        note="The archive is the Department's published justification material: Defense-Wide and Department-level books. Where a service's own book is not here, it has not been collected — the picker shows what is held rather than implying a gap in the Department's publishing.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Books" value={fmtInt(books)}
            sub={`across ${funds.length} appropriations`} tone="accent" />
          <StatTile label="Editions" value={fmtInt(editions)}
            sub={`PB${oldest}–PB${latestPb ?? ''}, each held separately`} />
          <StatTile label="Current books" value={fmtInt(current)}
            sub="published in the newest President's Budget or the one before, and carrying example text" />
          <StatTile label="Authoring" value={authoringOpen ? 'open' : 'closed'}
            tone={authoringOpen ? 'default' : 'warning'}
            sub={authoringOpen
              ? 'a token is required to save, export or draft on the local model'
              : 'JBOOK_TOKEN is not set on this deployment, so nothing can be written'} />
        </div>
        <Caveat>
          The grain is (book, President&rsquo;s Budget year) and nothing on this page collapses it.
          One year&rsquo;s book is not an average of its predecessors: DISA&rsquo;s OP-5 printed a
          reconciliation section from PB2012 to PB2021 and has not since, and that is visible only
          because each edition is kept as itself. Control{' '}
          <Link href="/controls" className="text-accent-400 hover:underline">JB-01</Link> refuses a
          load where the extract has collapsed it.
        </Caveat>
      </Section>

      <Section title="Pick a book, then write one" id="compose"
        note={llm.online
          ? 'The local model server is reachable, so a section can be drafted on it against this book’s own measurements and its own published passages. It is told to write a bracketed placeholder rather than a figure it was not given.'
          : `The local model server is not reachable right now (${llm.reason ?? 'no answer'}), so drafting on it is unavailable. Everything else here — the skeleton, the word bands, the published passages, the screen and versioning — is read from the database and works regardless.`}>
        <JBookStudio
          funds={funds.map((f) => ({ fundKey: f.fundKey, fundLabel: f.fundLabel,
            books: Number(f.books), editions: Number(f.editions), current: Number(f.current),
            firstPbYear: f.firstPbYear, latestPbYear: f.latestPbYear }))}
          initialBooks={initialBooks} initialFund={initialFund}
          lexicon={lexicon} llmOnline={llm.online} />
      </Section>

      <Section title="The forbidden lexicon"
        note="Words and phrases that must not reach a narrative bound for Congress. The rule is editorial rather than statutory, and the distinction is worth stating: the FMR requires a PBD or PDM number in the internal data submission that drives the change tables, and the same reference must not surface in the published narrative, because it exposes predecisional deliberation.">
        <DataTable
          align={[0, 1, 2, 3, 4]}
          caption={`${lexicon.length} phrases active, ${blocking} of which refuse a save. Seeded entries carry an authority where one exists and say so where it is a house rule. Anything you add is screened identically.`}
          head={['Phrase', 'Effect', 'Why', 'Instead', 'Authority']}
          rows={lexicon.map((l) => [
            <span key={l.id} className="font-mono text-[12px] text-navy-100">{l.phrase}</span>,
            <span key={`${l.id}-s`} className={`text-[12px] uppercase tracking-wider font-semibold ${
              l.severity === 'block' ? 'text-red-300' : 'text-amber-300'}`}>
              {l.severity === 'block' ? 'blocks a save' : 'review'}
            </span>,
            <span key={`${l.id}-r`} className="text-[12px] text-navy-400 leading-relaxed">{l.rationale}</span>,
            <span key={`${l.id}-g`} className="text-[12px] text-navy-300">{l.suggestion ?? '—'}</span>,
            <span key={`${l.id}-a`} className="text-[12px] text-navy-500">{l.authority ?? '—'}</span>,
          ])} />
        <LexiconAdd count={lexicon.length} />
      </Section>

      {styles.length > 0 && (
        <Section title="The R-2, measured across components"
          note="The exhibit grain: the R-2 and R-2A exhibits inside the current Defense-Wide RDT&E books, parsed with their bodies. This is the one place the corpus goes below book level, and it is where the letters themselves are learned — a project-level R-2A carries no Program Change Summary, so Acquisition Strategy is section D there and section E on a program-element R-2.">
          <DataTable
            align={[0, 1]}
            caption="Median, minimum and maximum words per section across the exhibits held for that component, with mean sentence length."
            head={['Component', 'Section', 'Exhibits', 'Median words', 'Range', 'Sentence length']}
            rows={styles.slice(0, 12).map((s, i) => [
              <span key={i} className="text-navy-100">{s.component}</span>,
              <span key={`${i}-l`} className="text-[12px] text-navy-400">{s.letter}. {s.title}</span>,
              String(s.sampleSize),
              <span key={`${i}-m`} className="text-accent-300">{s.medianWords}</span>,
              <span key={`${i}-r`} className="text-[12px] text-navy-500">{s.minWords}–{s.maxWords}</span>,
              s.avgSentenceWords ? `${s.avgSentenceWords} words` : '—',
            ])} />
        </Section>
      )}

      <Section title="How this is meant to be used">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4 text-sm text-navy-300 leading-relaxed">
          <p>
            <strong className="text-navy-100">The format is read, not typed.</strong> Sections, their
            order, their length and whether a book still prints them all come from parsing the books
            themselves. When the next President&rsquo;s Budget changes a format, re-running the extract
            changes this page — nobody edits a template.
          </p>
          <p>
            <strong className="text-navy-100">Recent editions weigh more.</strong> Each book&rsquo;s
            skeleton is weighted on a three-year half-life, so what it does now outranks what it did
            in PB2011 — and what it has stopped doing is listed rather than dropped.
          </p>
          <p>
            <strong className="text-navy-100">Dates are where a book goes stale.</strong> Every
            section is measured for dated, scheduled and milestone language. A section whose
            published versions carry a schedule and whose draft carries none is flagged before it
            goes, not after it comes back.
          </p>
          <p>
            <strong className="text-navy-100">No figure is invented.</strong> The scaffold is
            placeholders. The local model is instructed to write a bracketed placeholder rather than
            a number it was not given, and the readiness check blocks a save on any placeholder left
            behind. A blank is obviously unfinished; a fabricated figure survives review.
          </p>
          <p>
            <strong className="text-navy-100">Your work is yours.</strong> Documents, versions,
            uploads and the phrases you add live in tables that carry no load reference and appear in
            no loader map. A refresh replaces the corpus and cannot touch them.
          </p>
          <p>
            <strong className="text-navy-100">DOCX round-trips.</strong> Export, edit offline, and
            bring it back: the import reads the .docx itself and matches your headings back to the
            sections they came from, saving the result as a version marked imported.
          </p>
        </div>
        <p className="text-[12px] text-navy-500 mt-8">
          Corpus and vintages: <Link href="/sources" className="text-accent-400 hover:underline">sources</Link>
          {' '}· the controls over this corpus:{' '}
          <Link href="/controls" className="text-accent-400 hover:underline">JB-01, JB-02, JB-03</Link>
          {' '}· <Link href="/definitions" className="text-accent-400 hover:underline">definitions</Link>
        </p>
      </Section>
    </Shell>
  );
}
