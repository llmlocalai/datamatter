/**
 * Grounding the chat in this site's own data.
 *
 * The models on the Mac Studio were trained on this material, which is what
 * makes them worth asking. It is also exactly why the answers need sources
 * attached: a model that has read every justification book will produce a
 * confident figure for one it has not, and a figure without a source is the one
 * thing this site does not publish.
 *
 * So every question is answered with a retrieved context block and a list of
 * sources the reader can open. Retrieval runs over three things:
 *
 *   - the curated DoD-FM knowledge wiki (BM25, authority re-ranked) -- the same
 *     index and the same scoring /regulation uses, so the two cannot disagree;
 *   - the site's defined terms, which carry their own authorities;
 *   - the justification-book corpus, which is the only place a question about a
 *     particular book's format can be answered from.
 *
 * The dataset vintages are always included, because "how current is this" is the
 * question behind most of the others and the answer is never "today".
 */
import { query } from './db';
import { searchKnowledge, type KnowledgeHit } from './knowledge-index';
import { missingColumns } from './schema';

export interface AskSource {
  kind: 'wiki' | 'definition' | 'book' | 'dataset';
  title: string;
  detail: string;
  href?: string;
  source?: string;
}

export interface AskContext {
  system: string;
  context: string;
  sources: AskSource[];
}

const MAX_CONTEXT = 9_000;   // characters, so a small model is not drowned

const SYSTEM = `You are the assistant on datamatter, a Department of War budget,
execution and audit analytics site built on the USASpending account and award
warehouse and a curated DoD financial-management knowledge bank.

How to answer:
- Answer from the CONTEXT below and from what you know of DoD budget formulation,
  execution, the justification books and the FMR. Be concise and concrete.
- Every figure you state must come from the context or be one you attribute
  explicitly to the source it came from, with its fiscal year and vintage. If you
  do not have a figure, say which page of this site carries it instead of
  estimating one. A fabricated number here is worse than no number.
- If the context does not answer the question, say what it does cover and point
  at the page. Do not say the data "does not contain" something you have not
  checked: an empty search means the search matched nothing.
- The Department is named Department of War (Executive Order 14347) in framing,
  but source systems keep their own names: DoD, agency 097, USASpending, FPDS.
- Obligations are not outlays. A period-to-date figure must be named as one.
- Never ask for and never repeat controlled unclassified information. If a user
  pastes something that looks operational or CUI, say it does not belong here.`;

/** Compact, so the vintages cost a few hundred characters rather than a page. */
async function datasetLines(): Promise<{ text: string; sources: AskSource[] }> {
  const rows = await query<{ key: string; label: string; vintage: string; extracted: string }>(
    `SELECT l.dataset_key AS key, coalesce(d.label, l.dataset_key) AS label,
            l.vintage::text AS vintage, to_char(l.extracted_at, 'YYYY-MM-DD') AS extracted
       FROM dm_load l LEFT JOIN dm_dataset d ON d.key = l.dataset_key
      WHERE l.is_current ORDER BY l.dataset_key`);
  return {
    text: rows.length
      ? `Datasets currently loaded (vintage = the source's own date):\n`
        + rows.map((r) => `- ${r.label}: vintage ${r.vintage}`).join('\n')
      : '',
    sources: rows.slice(0, 1).map(() => ({
      kind: 'dataset' as const, title: 'Dataset vintages', href: '/sources',
      detail: `${rows.length} datasets, each with its source, grain and limitations.` })),
  };
}

async function definitionHits(q: string) {
  return query<{ term: string; slug: string; definition: string; authorities: string }>(
    `SELECT d.term, d.slug, d.definition, d.authorities
       FROM dm_definition d JOIN dm_load l ON l.id = d.load_id AND l.is_current
      WHERE d.term ILIKE '%' || $1 || '%' OR d.definition ILIKE '%' || $1 || '%'
      ORDER BY length(d.term) LIMIT 3`, [q.slice(0, 60)]);
}

/**
 * Sections of the justification books matching the question.
 *
 * This is the part of retrieval the knowledge wiki cannot do. Asked what a
 * Program Change Summary has to carry, BM25 over 392 wiki passages returns
 * whatever shares its words; the corpus knows the section itself -- which books
 * print it, how many of their editions do, how long it runs and how much of it
 * is dated. Those are measurements, and they are the answer.
 */
async function sectionHits(q: string) {
  // Match on the question's significant WORDS, not on the whole string: a
  // question is a sentence and a section title is three words, so a LIKE over
  // the sentence matches nothing. Half the words have to land, so "Program
  // Change Summary" finds the section and "what must a book carry" does not
  // drag in every title containing "summary".
  const terms = q.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 3 && !['MUST', 'WHAT', 'WHICH', 'DOES', 'THIS', 'THAT',
      'WITH', 'FROM', 'HAVE', 'BOOK', 'BOOKS', 'SECTION', 'WRITE', 'SHOULD'].includes(w))
    .slice(0, 6);
  if (!terms.length) return [];
  const need = terms.length === 1 ? 1 : Math.ceil(terms.length / 2);
  return query<{ title: string; books: number; editions: number; medianWords: number;
                 timeSharePct: number; example: string; latestPb: number; matched: number }>(
    `WITH m AS (
       SELECT k.*, b.title AS book_title,
              (SELECT count(*) FROM unnest($1::text[]) w
                WHERE k.norm_title LIKE '%' || w || '%')::int AS matched
         FROM dm_jbook_book_skeleton k JOIN dm_load l ON l.id = k.load_id AND l.is_current
         JOIN dm_jbook_book b ON b.load_id = k.load_id AND b.book_key = k.book_key
        WHERE k.is_current
     )
     SELECT max(m.title) AS title, count(DISTINCT m.book_key)::int AS books,
            sum(m.years_seen)::int AS editions,
            round(avg(m.median_words))::int AS "medianWords",
            round(avg(m.time_share_pct), 1) AS "timeSharePct",
            max(m.book_title) AS example, max(m.last_seen_pb) AS "latestPb",
            max(m.matched)::int AS matched
       FROM m WHERE m.matched >= $2
      GROUP BY m.norm_title
      ORDER BY max(m.matched) DESC, count(DISTINCT m.book_key) DESC
      LIMIT 4`, [terms, need]);
}

/** Retrieval over the book grain is skipped on a database that has not been
 *  migrated to it yet, rather than failing the whole question. */
async function bookGrainPresent(): Promise<boolean> {
  try { return (await missingColumns('dm_jbook_book', ['book_key'])).length === 0; }
  catch { return false; }
}

async function bookHits(q: string) {
  return query<{ bookKey: string; title: string; fundLabel: string; yearsHeld: number;
                 firstPbYear: number; latestPbYear: number; exhibits: string | null }>(
    `SELECT b.book_key AS "bookKey", b.title, b.fund_label AS "fundLabel",
            b.years_held AS "yearsHeld", b.first_pb_year AS "firstPbYear",
            b.latest_pb_year AS "latestPbYear", b.exhibits
       FROM dm_jbook_book b JOIN dm_load l ON l.id = b.load_id AND l.is_current
      WHERE b.title ILIKE '%' || $1 || '%' OR b.exhibits ILIKE '%' || $1 || '%'
      ORDER BY b.is_current DESC, b.years_held DESC LIMIT 4`, [q.slice(0, 40)]);
}

/**
 * Build the context for one question.
 *
 * Failure to retrieve is not failure to answer: if the database is unreachable
 * the model still gets the question and the system prompt, and the reply simply
 * carries fewer sources. Losing the chat entirely because a query timed out
 * would be the worse outcome.
 */
export async function buildAskContext(question: string): Promise<AskContext> {
  const sources: AskSource[] = [];
  const parts: string[] = [];

  let wiki: KnowledgeHit[] = [];
  try {
    wiki = searchKnowledge(question, 5);
  } catch { /* the index ships with the app; if it is unreadable, carry on */ }
  // A floor relative to the best hit: BM25 always returns something, and a
  // passage scoring a twentieth of the top one is noise with a citation on it.
  const top = wiki[0]?.score ?? 0;
  wiki = wiki.filter((w) => w.score >= top * 0.25);
  if (wiki.length) {
    parts.push('Knowledge-bank passages (authority-ranked):\n'
      + wiki.map((w) => `- [${w.page} — ${w.section}] ${w.text.slice(0, 700)} (source: ${w.source})`)
          .join('\n'));
    for (const w of wiki.slice(0, 4)) {
      sources.push({ kind: 'wiki', title: w.page, detail: w.section,
        source: w.source, href: `/regulation?q=${encodeURIComponent(question.slice(0, 80))}` });
    }
  }

  const haveBooks = await bookGrainPresent();
  const [defs, books, sections, datasets] = await Promise.all([
    definitionHits(question).catch(() => []),
    haveBooks ? bookHits(question).catch(() => []) : [],
    haveBooks ? sectionHits(question).catch(() => []) : [],
    datasetLines().catch(() => ({ text: '', sources: [] as AskSource[] })),
  ]);

  if (sections.length) {
    parts.push('Justification-book sections matching the question, measured across the books that '
      + 'print them:\n'
      + sections.map((s) => `- "${s.title}": printed by ${s.books} book(s) in ${s.editions} `
          + `edition(s), median ${s.medianWords} words, ${s.timeSharePct}% of published versions `
          + `carry a date or a schedule (e.g. ${s.example}, last seen PB${s.latestPb})`).join('\n'));
    for (const s of sections.slice(0, 3)) {
      sources.push({ kind: 'book', title: s.title,
        detail: `${s.books} books, ${s.editions} editions, median ${s.medianWords} words`,
        href: '/jbook' });
    }
  }

  if (defs.length) {
    parts.push('Defined terms on this site:\n'
      + defs.map((d) => `- ${d.term}: ${d.definition.slice(0, 400)}`).join('\n'));
    for (const d of defs) {
      sources.push({ kind: 'definition', title: d.term, detail: d.definition.slice(0, 140),
        href: `/definitions#${d.slug}` });
    }
  }

  if (books.length) {
    parts.push('Justification books held (book grain, one identity across editions):\n'
      + books.map((b) => `- ${b.title} (${b.fundLabel}): ${b.yearsHeld} editions, `
          + `PB${b.firstPbYear}–PB${b.latestPbYear}`
          + `${b.exhibits ? `, exhibits ${b.exhibits}` : ''}`).join('\n'));
    for (const b of books) {
      sources.push({ kind: 'book', title: b.title,
        detail: `${b.fundLabel} · ${b.yearsHeld} editions, PB${b.firstPbYear}–PB${b.latestPbYear}`,
        href: `/jbook?book=${encodeURIComponent(b.bookKey)}` });
    }
  }

  if (datasets.text) {
    parts.push(datasets.text);
    sources.push(...datasets.sources);
  }

  let context = parts.join('\n\n');
  if (context.length > MAX_CONTEXT) context = context.slice(0, MAX_CONTEXT) + '\n[context truncated]';

  return { system: SYSTEM, context, sources };
}
