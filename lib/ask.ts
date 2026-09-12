/**
 * Grounding the chat in this site's own data.
 *
 * The models on the Mac Studio were trained on this material, which is what
 * makes them worth asking. It is also exactly why the answers need sources
 * attached: a model that has read every justification book will produce a
 * confident figure for one it has not, and a figure without a source is the one
 * thing this site does not publish.
 *
 * WHAT CHANGED, AND WHY IT MATTERED. The first cut retrieved the knowledge wiki,
 * the defined terms, and COUNTS of justification books — how many editions, how
 * many words. Not one line of the books themselves, and not a single figure from
 * the site's own measures. So the chat could say that 295 books print a Program
 * Change Summary and could not quote one, and could not tell you FY2025
 * obligations while every page on the site published them. It read as a model
 * that had never seen the corpus, because in the only sense that matters here it
 * had not.
 *
 * Retrieval now runs over seven things, each in its own function so a failure in
 * one costs that source and not the answer:
 *
 *   - justification-book PASSAGES, full text, from both grains (the R-2 exhibit
 *     sections and the per-book exemplars), each naming its book, PB year, file
 *     and page;
 *   - the per-book skeleton, so "what must this section carry" is answered from
 *     what the books actually print;
 *   - book identities and their year spans;
 *   - the site's own measures — the Statement of Budgetary Resources chain,
 *     the direct/reimbursable split, contract obligations and their linkage;
 *   - programme lines from the President's Budget exhibits, by name;
 *   - the control suite, which is how this site says what it does not trust;
 *   - the curated knowledge wiki (BM25, authority re-ranked) — the same index
 *     and the same scoring /regulation uses, so the two cannot disagree.
 *
 * The dataset vintages and a map of what each page covers are always included:
 * "how current is this" is the question behind most of the others, and a model
 * that can name the right page is more useful than one that guesses a figure.
 */
import { query } from './db';
import { searchKnowledge, type KnowledgeHit } from './knowledge-index';
import { missingColumns } from './schema';

export interface AskSource {
  kind: 'wiki' | 'definition' | 'book' | 'passage' | 'figure' | 'program' | 'control' | 'dataset';
  title: string;
  detail: string;
  href?: string;
  source?: string;
}

export interface AskContext {
  system: string;
  context: string;
  sources: AskSource[];
  /** What retrieval actually found, so the page can show it rather than imply it. */
  retrieved: Record<string, number>;
}

const MAX_CONTEXT = 14_000;   // characters; the local models run at 8k+ context

const SYSTEM = `You are the assistant on datamatter, a Department of War budget,
execution and audit analytics site built on the USASpending account and award
warehouse, the published justification books, and a curated DoD
financial-management knowledge bank.

How to answer:
- Answer from the CONTEXT below first. It contains real passages from the
  justification books and real figures from this site's database. Quote and cite
  them: name the book, the PB year and the page for a passage; the fiscal year
  and the vintage for a figure.
- Every figure you state must come from the context or be attributed explicitly
  to where it came from. If the context does not carry it, say which page of this
  site does instead of estimating. A fabricated number here is worse than none.
- If the context does not answer the question, say what it does cover and point
  at the page. Do not say the data "does not contain" something you have not
  checked: an empty search means the search matched nothing.
- The Department is named Department of War (Executive Order 14347) in framing,
  but source systems keep their own names: DoD, agency 097, USASpending, FPDS.
- Obligations are not outlays. A period-to-date figure must be named as one.
  Direct and reimbursable obligations are never added together.
- Never ask for and never repeat controlled unclassified information. If a user
  pastes something that looks operational or CUI, say it does not belong here.`;

/** What each page carries, so the model can point instead of guess. */
const PAGE_MAP = `Pages on this site:
- /execution — the fiscal year in progress: authority through obligation and outlay, File B at object-class and expenditure-stage grain, execution by program year, contract timing against each category's own year-end history.
- /budget — the FY2027 request as the seven "-1" display tables, drilled appropriation to budget line item.
- /program — a budget line followed from the exhibits into execution and contracts.
- /jbook — every justification book in the archive, each book's own section skeleton, word bands and format drift, and the authoring surface.
- /reconciliation — award-file contract obligations against account-linked File C.
- /funds-control — obligation and outlay rates, unobligated balances, lapse exposure at Treasury account grain.
- /contracting — contract obligations by set-aside, extent competed, recipient, industry.
- /audit — opinion, material weaknesses and scope limitations from the AFR.
- /linkage, /traceability — where the chain between budget and contract breaks, and why.
- /controls — every validation rule, its rationale and its current result.
- /sources — every dataset with grain, vintage, transformation and stated limitations.
- /definitions, /regulation — defined terms with authorities, and authority-ranked passage search.`;

const fmtB = (n: number | null | undefined) =>
  n == null ? 'n/a' : Math.abs(n) >= 1e12 ? `$${(n / 1e12).toFixed(2)}T`
    : Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(1)}B`
    : `$${(n / 1e6).toFixed(1)}M`;

/** Significant words from a question, for LIKE and full-text matching. */
function terms(q: string): string[] {
  const STOP = new Set(['what', 'which', 'does', 'this', 'that', 'with', 'from', 'have', 'must',
    'should', 'about', 'there', 'their', 'where', 'when', 'were', 'been', 'they', 'them', 'into',
    'over', 'under', 'than', 'then', 'tell', 'show', 'give', 'many', 'much', 'know', 'like',
    'site', 'page', 'data']);
  return Array.from(new Set(q.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w.toLowerCase())))).slice(0, 8);
}

async function bookGrainPresent(): Promise<boolean> {
  try { return (await missingColumns('dm_jbook_book', ['book_key'])).length === 0; }
  catch { return false; }
}

/* ------------------------------------------------------------ the passages -- */

/**
 * Actual text from the justification books.
 *
 * Two grains, both searched, because they hold different things: the exhibit
 * grain has the R-2 narrative sections of the current Defense-Wide RDT&E books
 * with their full bodies, and the book grain has capped exemplar passages from
 * the two most recent editions of every current book in every appropriation.
 * A question about how a section is written is answered from these or it is
 * answered from the model's memory, which is exactly what this site does not do.
 */
/**
 * The phrase a question is really about.
 *
 * "What must a Program Change Summary carry?" is a question about one named
 * section, and a bag of words cannot tell that from a question containing the
 * words program, change and summary in three different sentences — which is how
 * the first version answered it with OP-32 line-item tables. Runs of capitalised
 * words are the phrase; anything quoted is taken as one too.
 */
function phrases(q: string): string[] {
  // re.exec in a loop rather than matchAll: this tsconfig has no
  // downlevelIteration, and matchAll's iterator will not compile under it.
  const out: string[] = [];
  const push = (re: RegExp) => {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(q)) !== null) {
      if (m[0].length === 0) { re.lastIndex += 1; continue; }
      out.push(m[1]);
    }
  };
  push(/"([^"]{4,60})"/g);
  push(/\b([A-Z][a-z]{2,}(?:\s+(?:of|and|for|the)\s+[A-Z]?[a-z]+|\s+[A-Z][a-z]{2,})+)\b/g);
  return Array.from(new Set(out)).slice(0, 2);
}

async function jbookPassages(q: string) {
  // OR-ing the words is what makes retrieval work at all; on its own it also
  // makes it fire on EVERY question, because some book somewhere contains
  // "failing" and "right". Three things decide instead, in order: does the
  // section TITLE match what was asked (a section is named, and its name is the
  // strongest signal there is), does the body carry the PHRASE, and only then
  // how many separate words landed and how densely. A passage that clears none
  // of those is dropped: a citation on an irrelevant passage is worse than no
  // citation, because it claims the corpus answered.
  const t = terms(q).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter((w) => w.length > 3);
  if (!t.length) return [];
  const ph = phrases(q);
  const rows = await query<{ kind: string; title: string; book: string; pbYear: number;
                 sourceFile: string | null; pageNo: number | null; body: string;
                 rank: number; matched: number; titleHit: number; phraseHit: boolean }>(
    `WITH q AS (SELECT to_tsquery('english', $1) AS tsq),
     hits AS (
       SELECT 'exhibit' AS kind, s.title,
              coalesce(e.component, '') || coalesce(' PE ' || e.pe, '') AS book,
              e.pb_year AS pb_year, e.source_file AS source_file, NULL::int AS page_no,
              s.body, to_tsvector('english', s.body) AS tsv
         FROM dm_jbook_section s
         JOIN dm_load l ON l.id = s.load_id AND l.is_current
         JOIN dm_jbook_exhibit e ON e.load_id = s.load_id AND e.slug = s.slug
         CROSS JOIN q
        WHERE NOT s.is_table AND to_tsvector('english', s.body) @@ q.tsq
       UNION ALL
       SELECT 'book', x.title, b.title, x.pb_year, x.source_file, x.page_no, x.body,
              to_tsvector('english', x.body)
         FROM dm_jbook_book_exemplar x
         JOIN dm_load l2 ON l2.id = x.load_id AND l2.is_current
         JOIN dm_jbook_book b ON b.load_id = x.load_id AND b.book_key = x.book_key
         CROSS JOIN q
        WHERE to_tsvector('english', x.body) @@ q.tsq
     ), scored AS (
       SELECT h.*,
              ts_rank_cd(h.tsv, (SELECT tsq FROM q)) AS rank,
              (SELECT count(*) FROM unnest($2::text[]) w
                WHERE h.tsv @@ plainto_tsquery('english', w))::int AS matched,
              (SELECT count(*) FROM unnest($2::text[]) w
                WHERE upper(h.title) LIKE '%' || upper(w) || '%')::int AS title_hit,
              ($3::text IS NOT NULL
                AND (h.tsv @@ phraseto_tsquery('english', $3)
                     OR upper(h.title) LIKE '%' || upper($3) || '%')) AS phrase_hit
         FROM hits h
     )
     SELECT kind, title, book, pb_year AS "pbYear", source_file AS "sourceFile",
            page_no AS "pageNo", body, rank, matched,
            title_hit AS "titleHit", phrase_hit AS "phraseHit"
       FROM scored
      WHERE phrase_hit OR title_hit >= 2 OR matched >= 3
      ORDER BY phrase_hit DESC, title_hit DESC, matched DESC, rank DESC
      LIMIT 6`, [t.join(' | '), t, ph[0] ?? null]);
  const best = rows[0]?.rank ?? 0;
  return rows.filter((r) => r.phraseHit || r.titleHit >= 2 || r.rank >= best * 0.2).slice(0, 4);
}

async function jbookSections(q: string) {
  const t = terms(q);
  if (!t.length) return [];
  const need = t.length === 1 ? 1 : Math.ceil(t.length / 2);
  return query<{ title: string; books: number; editions: number; medianWords: number;
                 timeSharePct: number; example: string; latestPb: number }>(
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
            max(m.book_title) AS example, max(m.last_seen_pb) AS "latestPb"
       FROM m WHERE m.matched >= $2
      GROUP BY m.norm_title
      ORDER BY max(m.matched) DESC, count(DISTINCT m.book_key) DESC LIMIT 4`, [t, need]);
}

async function bookHits(q: string) {
  const t = terms(q);
  if (!t.length) return [];
  return query<{ bookKey: string; title: string; fundLabel: string; yearsHeld: number;
                 firstPbYear: number; latestPbYear: number; exhibits: string | null }>(
    `SELECT b.book_key AS "bookKey", b.title, b.fund_label AS "fundLabel",
            b.years_held AS "yearsHeld", b.first_pb_year AS "firstPbYear",
            b.latest_pb_year AS "latestPbYear", b.exhibits
       FROM dm_jbook_book b JOIN dm_load l ON l.id = b.load_id AND l.is_current
      WHERE (SELECT count(*) FROM unnest($1::text[]) w
              WHERE upper(b.title) LIKE '%' || w || '%'
                 OR upper(coalesce(b.exhibits, '')) LIKE '%' || w || '%') > 0
      ORDER BY b.is_current DESC, b.years_held DESC LIMIT 4`, [t]);
}

/* -------------------------------------------------------------- the figures -- */

/**
 * The measures the site publishes, always included.
 *
 * These are four hundred characters that answer a whole class of question the
 * chat previously could not touch at all — and every one of them carries its
 * fiscal year and whether it is period-to-date, because a figure without that is
 * not an answer on this site.
 */
async function headlineFigures() {
  const rows = await query<{ fiscalYear: number; resources: number; obligations: number;
                             outlays: number; unobligated: number; period: string | null;
                             partial: boolean }>(
    `SELECT s.fiscal_year AS "fiscalYear", s.total_budgetary_resources AS resources,
            s.obligations_incurred AS obligations, s.gross_outlays AS outlays,
            s.unobligated_balance AS unobligated, s.submission_period AS period,
            s.is_partial_year AS partial
       FROM dm_sbr_fy s JOIN dm_load l ON l.id = s.load_id AND l.is_current
      WHERE s.scope = 'DOW' ORDER BY s.fiscal_year DESC LIMIT 3`);
  const rec = await query<{ fiscalYear: number; awardObligation: number; linkagePct: number;
                            awardActions: number; partial: boolean }>(
    `SELECT r.fiscal_year AS "fiscalYear", r.award_obligation AS "awardObligation",
            r.linkage_pct AS "linkagePct", r.award_actions AS "awardActions",
            r.is_partial_year AS partial
       FROM dm_reconciliation r JOIN dm_load l ON l.id = r.load_id AND l.is_current
      ORDER BY r.fiscal_year DESC LIMIT 2`).catch(() => []);
  const split = await query<{ fiscalYear: number; direct: number; reimbursable: number }>(
    `SELECT f.fiscal_year AS "fiscalYear",
            sum(f.obligations_direct) AS direct, sum(f.obligations_reimbursable) AS reimbursable
       FROM dm_exec_account_fy f JOIN dm_load l ON l.id = f.load_id AND l.is_current
      WHERE f.scope = 'DOW' AND f.obligations_direct IS NOT NULL
      GROUP BY 1 ORDER BY 1 DESC LIMIT 2`).catch(() => []);
  if (!rows.length) return { text: '', rows: [] as typeof rows };
  const lines = rows.map((r) => `- FY${r.fiscalYear}${r.partial ? ' (period-to-date, '
    + `${r.period ?? 'in progress'})` : ''}: total budgetary resources ${fmtB(r.resources)}, `
    + `obligations incurred ${fmtB(r.obligations)}, gross outlays ${fmtB(r.outlays)}, `
    + `unobligated balance ${fmtB(r.unobligated)}`);
  for (const s of split) {
    lines.push(`- FY${s.fiscalYear} File B split: direct ${fmtB(s.direct)}, reimbursable `
      + `${fmtB(s.reimbursable)} — never added together (a reimbursable obligation is another `
      + `account's direct obligation)`);
  }
  for (const r of rec) {
    lines.push(`- FY${r.fiscalYear}${r.partial ? ' (part year)' : ''} contract obligations `
      + `${fmtB(r.awardObligation)} across ${Number(r.awardActions).toLocaleString()} actions; `
      + `${r.linkagePct}% carry a Treasury account link`);
  }
  return { text: `Department-scope figures (agency codes 097, 021, 017, 057; 011 excluded):\n`
    + lines.join('\n'), rows };
}

/** Programme lines from the President's Budget exhibits, by name. */
async function programHits(q: string) {
  // A four-letter word matches half the roster ("MISSION" pulled five programme
  // lines into a question about how DARPA writes a paragraph). Five characters
  // and a match count, so a programme has to be named rather than brushed.
  const t = terms(q).filter((w) => w.length >= 5);
  if (!t.length) return [];
  return query<{ program: string; account: string; exhibit: string; bli: string;
                 latestPb: number; appropriation: string | null; amount: number | null }>(
    `SELECT p.program_name AS program, p.account, p.exhibit, p.bli, p.latest_pb AS "latestPb",
            p.appropriation, f.amount_k * 1000 AS amount
       FROM dm_exhibit_program p JOIN dm_load l ON l.id = p.load_id AND l.is_current
       LEFT JOIN dm_exhibit_program_fy f ON f.load_id = p.load_id AND f.account = p.account
            AND f.bli = p.bli AND f.pb_year = p.latest_pb AND f.fiscal_year = p.latest_pb
            AND NOT f.is_memo
      WHERE (SELECT count(*) FROM unnest($1::text[]) w
              WHERE upper(p.program_name) LIKE '%' || w || '%') > 0
      ORDER BY (SELECT count(*) FROM unnest($1::text[]) w
                 WHERE upper(p.program_name) LIKE '%' || w || '%') DESC,
               f.amount_k DESC NULLS LAST LIMIT 3`, [t]);
}

/** The control suite — how this site says what it does not trust. */
async function controlHits(q: string) {
  const wantsControls = /\b(control|check|validat|assert|test|trust|quality|fail|tie ?out|audit trail)/i
    .test(q);
  // dm_control_result carries NO load reference -- the loader replaces the whole
  // table each run, which is why /controls reads it with no join either. Joining
  // dm_load here returned zero rows and reported "0 of 0 assertions pass" on a
  // database with 489 passing.
  const summary = await query<{ total: number; pass: number; fail: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'pass')::int AS pass,
            count(*) FILTER (WHERE status <> 'pass')::int AS fail
       FROM dm_control_result`);
  const failing = wantsControls ? await query<{ code: string; name: string; severity: string;
                                                message: string }>(
    `SELECT DISTINCT ON (r.control_code) r.control_code AS code, c.name, c.severity, r.message
       FROM dm_control_result r
       LEFT JOIN dm_control c ON c.code = r.control_code
      WHERE r.status <> 'pass' ORDER BY r.control_code, r.run_at DESC LIMIT 6`).catch(() => []) : [];
  return { summary: summary[0], failing };
}

async function definitionHits(q: string) {
  const t = terms(q);
  if (!t.length) return [];
  return query<{ term: string; slug: string; definition: string; authorities: string }>(
    `SELECT d.term, d.slug, d.definition, d.authorities
       FROM dm_definition d JOIN dm_load l ON l.id = d.load_id AND l.is_current
      WHERE (SELECT count(*) FROM unnest($1::text[]) w
              WHERE upper(d.term) LIKE '%' || w || '%'
                 OR upper(d.definition) LIKE '%' || w || '%') > 0
      ORDER BY length(d.term) LIMIT 3`, [t]);
}

async function datasetLines() {
  const rows = await query<{ label: string; vintage: string }>(
    `SELECT coalesce(d.label, l.dataset_key) AS label, l.vintage::text AS vintage
       FROM dm_load l LEFT JOIN dm_dataset d ON d.key = l.dataset_key
      WHERE l.is_current ORDER BY 1`);
  return rows;
}

/* ------------------------------------------------------------------ build -- */

export async function buildAskContext(question: string): Promise<AskContext> {
  const sources: AskSource[] = [];
  const parts: string[] = [];
  const retrieved: Record<string, number> = {};
  const haveBooks = await bookGrainPresent();

  const [wikiRaw, passages, sections, books, figures, programs, controls, defs, datasets] =
    await Promise.all([
      Promise.resolve().then(() => { try { return searchKnowledge(question, 5); } catch { return []; } }),
      haveBooks ? jbookPassages(question).catch(() => []) : [],
      haveBooks ? jbookSections(question).catch(() => []) : [],
      haveBooks ? bookHits(question).catch(() => []) : [],
      headlineFigures().catch(() => ({ text: '', rows: [] })),
      programHits(question).catch(() => []),
      controlHits(question).catch(() => ({ summary: undefined, failing: [] })),
      definitionHits(question).catch(() => []),
      datasetLines().catch(() => []),
    ]);

  // 1. The books themselves, first: this is the material the question is usually about.
  if (passages.length) {
    retrieved.passages = passages.length;
    parts.push('Passages from the published justification books:\n'
      + passages.map((p) => `- [${p.book}, PB${p.pbYear}, ${p.sourceFile ?? 'book'}`
          + `${p.pageNo ? ` p${p.pageNo}` : ''}] "${p.title}": ${p.body.slice(0, 1100)}`).join('\n\n'));
    for (const p of passages.slice(0, 4)) {
      sources.push({ kind: 'passage', title: `${p.title} — ${p.book}`,
        detail: `PB${p.pbYear}${p.pageNo ? `, page ${p.pageNo}` : ''}, ${p.body.length} characters`,
        source: p.sourceFile ?? undefined, href: '/jbook' });
    }
  }

  if (sections.length) {
    retrieved.sections = sections.length;
    parts.push('How the books print these sections, measured across the books that print them:\n'
      + sections.map((s) => `- "${s.title}": printed by ${s.books} book(s) in ${s.editions} `
          + `edition(s), median ${s.medianWords} words, ${s.timeSharePct}% of published versions `
          + `carry a date or a schedule (e.g. ${s.example}, last seen PB${s.latestPb})`).join('\n'));
    for (const s of sections.slice(0, 2)) {
      sources.push({ kind: 'book', title: s.title,
        detail: `${s.books} books, ${s.editions} editions, median ${s.medianWords} words`,
        href: '/jbook' });
    }
  }

  if (books.length) {
    retrieved.books = books.length;
    parts.push('Justification books held (one identity across its editions):\n'
      + books.map((b) => `- ${b.title} (${b.fundLabel}): ${b.yearsHeld} editions, `
          + `PB${b.firstPbYear}–PB${b.latestPbYear}${b.exhibits ? `, exhibits ${b.exhibits}` : ''}`)
        .join('\n'));
    for (const b of books.slice(0, 3)) {
      sources.push({ kind: 'book', title: b.title,
        detail: `${b.fundLabel} · ${b.yearsHeld} editions, PB${b.firstPbYear}–PB${b.latestPbYear}`,
        href: `/jbook?book=${encodeURIComponent(b.bookKey)}` });
    }
  }

  // 2. The measures, always.
  if (figures.text) {
    retrieved.figures = figures.rows.length;
    parts.push(figures.text);
    sources.push({ kind: 'figure', title: 'Statement of Budgetary Resources chain',
      detail: 'Department scope, by fiscal year, with the period each figure is measured at',
      href: '/execution' });
  }

  if (programs.length) {
    retrieved.programs = programs.length;
    parts.push('Programme lines in the President’s Budget exhibits:\n'
      + programs.map((p) => `- ${p.program} (${p.exhibit} ${p.account} line ${p.bli}`
          + `${p.appropriation ? `, ${p.appropriation}` : ''}): PB${p.latestPb} `
          + `${p.amount ? fmtB(Number(p.amount)) : 'amount not in this row'}`).join('\n'));
    for (const p of programs.slice(0, 3)) {
      sources.push({ kind: 'program', title: p.program,
        detail: `${p.exhibit} ${p.account} line ${p.bli}, PB${p.latestPb}`, href: '/program' });
    }
  }

  if (controls.summary) {
    retrieved.controls = controls.failing.length;
    parts.push(`Validation: ${controls.summary.pass} of ${controls.summary.total} control `
      + `assertions pass on the current load. A critical failure rolls the load back, so a `
      + `published figure has passed every critical control.`
      + (controls.failing.length
          ? `\nCurrently failing, published as findings:\n`
            + controls.failing.map((c) => `- ${c.code} (${c.severity}) ${c.name}: `
                + `${c.message.slice(0, 260)}`).join('\n')
          : ''));
    if (controls.failing.length) {
      sources.push({ kind: 'control', title: `${controls.failing.length} control findings`,
        detail: 'Published alongside the data they concern', href: '/controls' });
    }
  }

  if (defs.length) {
    retrieved.definitions = defs.length;
    parts.push('Defined terms on this site:\n'
      + defs.map((d) => `- ${d.term}: ${d.definition.slice(0, 400)}`).join('\n'));
    for (const d of defs) {
      sources.push({ kind: 'definition', title: d.term, detail: d.definition.slice(0, 140),
        href: `/definitions#${d.slug}` });
    }
  }

  // 3. The wiki, with a floor relative to the best hit: BM25 always returns
  // something, and a passage scoring a twentieth of the top one is noise with a
  // citation on it.
  const top = (wikiRaw as KnowledgeHit[])[0]?.score ?? 0;
  const wiki = (wikiRaw as KnowledgeHit[]).filter((w) => w.score >= top * 0.25);
  if (wiki.length) {
    retrieved.wiki = wiki.length;
    parts.push('Knowledge-bank passages (authority-ranked):\n'
      + wiki.map((w) => `- [${w.page} — ${w.section}] ${w.text.slice(0, 700)} (source: ${w.source})`)
        .join('\n'));
    for (const w of wiki.slice(0, 3)) {
      sources.push({ kind: 'wiki', title: w.page, detail: w.section, source: w.source,
        href: `/regulation?q=${encodeURIComponent(question.slice(0, 80))}` });
    }
  }

  if (datasets.length) {
    parts.push(`Dataset vintages (the source's own date, never today):\n`
      + datasets.map((d) => `- ${d.label}: ${d.vintage}`).join('\n'));
    sources.push({ kind: 'dataset', title: 'Sources and vintages',
      detail: `${datasets.length} datasets, each with its grain and stated limitations`,
      href: '/sources' });
  }

  parts.push(PAGE_MAP);

  let context = parts.join('\n\n');
  if (context.length > MAX_CONTEXT) context = context.slice(0, MAX_CONTEXT) + '\n[context truncated]';

  return { system: SYSTEM, context, sources, retrieved };
}

/** What retrieval can draw on right now — reported by the status endpoint. */
export async function corpusStatus() {
  const out: Record<string, number> = {};
  try {
    const r = await query<{ books: number; exemplars: number; sections: number }>(
      `SELECT (SELECT count(*)::int FROM dm_jbook_book b JOIN dm_load l ON l.id = b.load_id AND l.is_current) AS books,
              (SELECT count(*)::int FROM dm_jbook_book_exemplar x JOIN dm_load l ON l.id = x.load_id AND l.is_current) AS exemplars,
              (SELECT count(*)::int FROM dm_jbook_section s JOIN dm_load l ON l.id = s.load_id AND l.is_current) AS sections`);
    out.books = r[0]?.books ?? 0;
    out.passages = (r[0]?.exemplars ?? 0) + (r[0]?.sections ?? 0);
  } catch { out.books = 0; out.passages = 0; }
  try {
    const d = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM dm_definition d JOIN dm_load l ON l.id = d.load_id AND l.is_current`);
    out.definitions = d[0]?.n ?? 0;
  } catch { out.definitions = 0; }
  try {
    const f = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM dm_sbr_fy s JOIN dm_load l ON l.id = s.load_id AND l.is_current WHERE s.scope = 'DOW'`);
    out.fiscalYears = f[0]?.n ?? 0;
  } catch { out.fiscalYears = 0; }
  try {
    const { knowledgeCorpus } = await import('./knowledge-index');
    out.wiki = knowledgeCorpus().docCount;
  } catch { out.wiki = 0; }
  return out;
}
