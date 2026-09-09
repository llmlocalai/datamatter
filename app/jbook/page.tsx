import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, DataTable } from '@/components/charts';
import { fmtInt } from '@/components/format';
import { getProvenance, isLoaded } from '@/lib/analytics';
import { getSkeleton, getStyleProfiles, getLexicon, getComponents, getExemplars } from '@/lib/jbook';
import { NotLoaded } from '../execution/page';
import Composer from './composer';

export const metadata: Metadata = {
  title: 'Justification book · datamatter',
  description:
    'Learn the R-2 justification exhibit from the published books, then write one: the format taken from the corpus rather than a template, the house voice measured per component, a forbidden-phrase screen that runs on every save, versioning, and DOCX export that round-trips back on import.',
};
export const revalidate = 900;

export default async function JBookPage() {
  if (!(await isLoaded())) return <Shell><NotLoaded /></Shell>;

  const [prov, skeleton, styles, lexicon, components] = await Promise.all([
    getProvenance('jbook_corpus'), getSkeleton('R-2'), getStyleProfiles(),
    getLexicon(), getComponents(),
  ]);
  if (!prov || !skeleton.length) return <Shell><NotLoaded /></Shell>;

  const skeletonA = await getSkeleton('R-2A');
  const top = components[0]?.component ?? '';
  const exemplars = top ? await getExemplars(top, 'A', 2) : [];
  const totalExhibits = components.reduce((s, c) => s + Number(c.exhibits), 0);
  const blocking = lexicon.filter((l) => l.severity === 'block').length;
  const authoringOpen = !!process.env.JBOOK_TOKEN;

  return (
    <Shell>
      <PageHeader
        eyebrow="Justification · learn the book, then write one"
        title={<>The <span className="text-accent-400">R-2</span>, learned from the books that exist</>}
        lede="A justification exhibit is not free prose. It is a fixed sequence of lettered sections wrapped around a fixed cost table, written in a house voice that differs measurably between components. This page reads that format out of the published books rather than out of a template someone typed, measures how each component actually writes each section, and gives you a place to write a new one against both — with a screen that will not let an internal deliberative reference reach a page bound for Congress."
      />

      <div className="mt-6"><ProvenanceBar p={prov}
        extra="Sections, order and style are measured from the published FY2027 Defense-Wide RDT&E justification books. What you write is stored in tables of its own that no data refresh touches." /></div>

      <Section title="What has been learned"
        note="Read from the books themselves. The section letters shift between exhibit types, which is exactly the sort of thing a hand-written template gets wrong.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Exhibits parsed" value={fmtInt(totalExhibits)}
            sub={`R-2 and R-2A across ${components.length} components`} tone="accent" />
          <StatTile label="Style profiles" value={String(styles.length)}
            sub="component × section, measured word counts and sentence length" />
          <StatTile label="Phrases screened" value={String(lexicon.length)}
            sub={`${blocking} block a save, ${lexicon.length - blocking} raise a review`} />
          <StatTile label="Authoring" value={authoringOpen ? 'open' : 'closed'}
            tone={authoringOpen ? 'default' : 'warning'}
            sub={authoringOpen
              ? 'a token is required to save, export or add a phrase'
              : 'JBOOK_TOKEN is not set on this deployment, so nothing can be written'} />
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
          {([['R-2', 'Program element level', skeleton],
             ['R-2A', 'Project level', skeletonA]] as const).map(([kind, label, rows]) => (
            <div key={kind}>
              <h3 className="text-sm font-semibold text-navy-200 mb-3">
                {kind} — {label}
              </h3>
              <DataTable
                align={[0, 1, 2]}
                head={['', 'Section', 'Form', 'Appears on']}
                rows={rows.map((s) => [
                  <span key={s.letter} className="font-mono text-accent-300">{s.letter}.</span>,
                  <span key={`${s.letter}-t`} className="text-navy-100">{s.title}</span>,
                  <span key={`${s.letter}-f`} className="text-[12px] text-navy-500">
                    {s.isTable ? 'table' : 'prose'}
                  </span>,
                  <span key={`${s.letter}-s`}
                    className={s.isRequired ? 'text-accent-300' : 'text-navy-400'}>
                    {s.sharePct}%
                    <span className="block text-[11px] text-navy-500">
                      {s.seenCount} of {s.exhibitsTotal}
                    </span>
                  </span>,
                ])} />
            </div>
          ))}
        </div>
        <Caveat>
          Note what the two skeletons show: a project-level R-2A carries no Program Change Summary,
          so Acquisition Strategy is section <span className="font-mono">D</span> there and section{' '}
          <span className="font-mono">E</span> on a program-element R-2. The letters are not
          decoration and they are not fixed across exhibit types.
        </Caveat>
      </Section>

      <Section title="The house voice, measured"
        note="How each component actually writes each section, in words. A draft can be compared with this rather than with an impression of it — and the spread between components is real: the same section runs to a median of 263 words at one and 356 at another.">
        <DataTable
          align={[0, 1]}
          caption="Median, minimum and maximum words per section across the exhibits held for that component, with mean sentence length. Sections that are tables are excluded, because their length is a function of the programme rather than of the writing."
          head={['Component', 'Section', 'Exhibits', 'Median words', 'Range', 'Sentence length']}
          rows={styles.slice(0, 14).map((s, i) => [
            <span key={i} className="text-navy-100">{s.component}</span>,
            <span key={`${i}-l`} className="text-[12px] text-navy-400">{s.letter}. {s.title}</span>,
            String(s.sampleSize),
            <span key={`${i}-m`} className="text-accent-300">{s.medianWords}</span>,
            <span key={`${i}-r`} className="text-[12px] text-navy-500">
              {s.minWords}–{s.maxWords}
            </span>,
            s.avgSentenceWords ? `${s.avgSentenceWords} words` : '—',
          ])} />

        {exemplars.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-navy-200 mb-3">
              How {top} opens a Mission Description
            </h3>
            <div className="space-y-3">
              {exemplars.map((e) => (
                <div key={e.slug} className="rounded-lg border border-navy-800 bg-navy-900/40 px-5 py-4">
                  <p className="text-[11px] font-mono text-navy-500 mb-2">
                    PE {e.pe} · {e.peTitle} · {e.wordCount} words
                  </p>
                  <p className="text-[13px] text-navy-300 leading-relaxed">
                    {e.body.slice(0, 700)}{e.body.length > 700 ? '…' : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="The forbidden lexicon"
        note="Words and phrases that must not reach a narrative bound for Congress. The rule is editorial rather than statutory, and the distinction is worth stating: the FMR requires a PBD or PDM number in the internal data submission that drives the change tables, and the same reference must not surface in the published narrative, because it exposes predecisional deliberation.">
        <DataTable
          align={[0, 1, 2, 3, 4]}
          caption="Seeded entries carry an authority where one exists and say so where it is a house rule. Anything you add is screened identically and is stored in a table no data refresh touches."
          head={['Phrase', 'Effect', 'Why', 'Instead', 'Authority']}
          rows={lexicon.map((l) => [
            <span key={l.id} className="font-mono text-[12px] text-navy-100">{l.phrase}</span>,
            <span key={`${l.id}-s`} className={`text-[11px] uppercase tracking-wider font-semibold ${
              l.severity === 'block' ? 'text-red-300' : 'text-amber-300'}`}>
              {l.severity === 'block' ? 'blocks a save' : 'review'}
            </span>,
            <span key={`${l.id}-r`} className="text-[12px] text-navy-400 leading-relaxed">{l.rationale}</span>,
            <span key={`${l.id}-g`} className="text-[12px] text-navy-300">{l.suggestion ?? '—'}</span>,
            <span key={`${l.id}-a`} className="text-[11px] text-navy-500">{l.authority ?? '—'}</span>,
          ])} />
      </Section>

      <Section title="Write one" id="compose"
        note="The sections below come from the skeleton above, in the order the corpus uses. The screen runs on the server as you type, so what it shows is what a save will enforce.">
        <Composer
          skeleton={skeleton.map((s) => ({
            letter: s.letter, title: s.title, isTable: s.isTable,
            sharePct: Number(s.sharePct), isRequired: s.isRequired,
          }))}
          styles={styles.map((s) => ({
            component: s.component, letter: s.letter, title: s.title,
            sampleSize: Number(s.sampleSize), medianWords: Number(s.medianWords),
            minWords: Number(s.minWords), maxWords: Number(s.maxWords),
            avgSentenceWords: s.avgSentenceWords == null ? null : Number(s.avgSentenceWords),
            exampleOpening: s.exampleOpening,
          }))}
          lexicon={lexicon.map((l) => ({
            id: l.id, phrase: l.phrase, severity: l.severity, category: l.category,
            rationale: l.rationale, suggestion: l.suggestion, authority: l.authority,
            isSeed: l.isSeed, isActive: l.isActive,
          }))}
          components={components.map((c) => ({ component: c.component, exhibits: Number(c.exhibits) }))}
        />
      </Section>

      <Section title="How this is meant to be used">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4 text-sm text-navy-300 leading-relaxed">
          <p>
            <strong className="text-navy-100">The format is read, not typed.</strong> Section
            letters, titles, order and whether a section is prose or a table all come from parsing
            the published books. When the next President&rsquo;s Budget changes the format, re-running
            the extract changes this page — nobody edits a template.
          </p>
          <p>
            <strong className="text-navy-100">Your work is yours.</strong> Documents, versions,
            uploads and the phrases you add live in tables that carry no load reference and appear in
            no loader map. A refresh replaces the corpus and cannot touch them.
          </p>
          <p>
            <strong className="text-navy-100">Nothing is stripped silently.</strong> A blocking
            phrase stops a save and is shown with its reason and a suggestion. You can override, and
            the override is recorded on the version with the count of what was present — so the
            decision is visible later rather than invisible.
          </p>
          <p>
            <strong className="text-navy-100">DOCX is the master.</strong> Export, edit offline,
            and bring it back through the import action as a new version marked as imported. The
            headings carry their section letters precisely so the round trip can find them again.
          </p>
        </div>
        <p className="text-xs text-navy-500 mt-8">
          Corpus and vintages: <Link href="/sources" className="text-accent-400 hover:underline">sources</Link>
          {' '}· the exhibits this narrative describes:{' '}
          <Link href="/program" className="text-accent-400 hover:underline">the program roster</Link>
          {' '}· <Link href="/definitions" className="text-accent-400 hover:underline">definitions</Link>
        </p>
      </Section>
    </Shell>
  );
}
