/**
 * Justification-book authoring: the corpus the format is learned from, the
 * forbidden-phrase screen, and the versioned documents a user writes.
 *
 * The screen is the point of this module. A justification narrative goes to
 * Congress, and the failure mode it has to prevent is not a typo — it is a
 * sentence carrying an internal deliberative reference that was never meant to
 * leave the building. So screening runs on every save, the hit count is stored
 * on the version, and a blocking hit is reported rather than silently stripped:
 * the person writing has to decide what the sentence should say instead.
 */
import { getPool } from './db';
import { missingColumns } from './schema';

export interface LexiconEntry {
  id: number; phrase: string; pattern: string | null;
  severity: 'block' | 'warn'; category: string;
  rationale: string; authority: string | null; suggestion: string | null;
  isSeed: boolean; isActive: boolean; addedBy: string | null;
}

export interface ScreenHit {
  phrase: string; severity: 'block' | 'warn'; category: string;
  rationale: string; suggestion: string | null; authority: string | null;
  letter: string; index: number; excerpt: string;
}

/** Escape a phrase so it can be used as a literal in a RegExp. */
function esc(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Find every forbidden phrase in a set of sections.
 *
 * A word-boundary match, not a substring one: "CUI" must not fire on
 * "circuit", and "draft" must not fire on "draughtsman". Where an entry
 * carries its own pattern that pattern wins, because some of these need to
 * match a number that follows them (PBD 704) and some must not.
 */
export function screen(
  sections: { letter: string; body: string }[],
  lexicon: LexiconEntry[],
): ScreenHit[] {
  const hits: ScreenHit[] = [];
  for (const entry of lexicon) {
    if (!entry.isActive) continue;
    let re: RegExp;
    try {
      re = new RegExp(entry.pattern ?? `\\b${esc(entry.phrase)}\\b`, 'gi');
    } catch {
      re = new RegExp(`\\b${esc(entry.phrase)}\\b`, 'gi');
    }
    for (const s of sections) {
      if (!s.body) continue;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s.body)) !== null) {
        const i = m.index;
        if (m[0].length === 0) { re.lastIndex += 1; continue; }
        hits.push({
          phrase: entry.phrase, severity: entry.severity, category: entry.category,
          rationale: entry.rationale, suggestion: entry.suggestion,
          authority: entry.authority, letter: s.letter, index: i,
          excerpt: s.body.slice(Math.max(0, i - 70), i + m[0].length + 70).trim(),
        });
      }
    }
  }
  return hits.sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === 'block' ? -1 : 1)
    || a.letter.localeCompare(b.letter) || a.index - b.index);
}

async function q<T = any>(text: string, params?: unknown[]): Promise<T[]> {
  const { rows } = await getPool().query(text, params);
  return rows as T[];
}

export async function getLexicon(includeInactive = false): Promise<LexiconEntry[]> {
  return q<LexiconEntry>(
    `SELECT id, phrase, pattern, severity, category, rationale, authority, suggestion,
            is_seed AS "isSeed", is_active AS "isActive", added_by AS "addedBy"
       FROM dm_jbook_lexicon
      WHERE ($1::boolean OR is_active)
      ORDER BY severity, category, lower(phrase)`, [includeInactive]);
}

export async function addLexiconEntry(e: {
  phrase: string; severity?: string; category?: string; rationale?: string;
  suggestion?: string; addedBy?: string;
}) {
  const rows = await q(
    `INSERT INTO dm_jbook_lexicon (phrase, severity, category, rationale, suggestion,
                                   is_seed, added_by)
     VALUES ($1, $2, $3, $4, $5, false, $6)
     ON CONFLICT (lower(phrase)) DO UPDATE SET
       severity = EXCLUDED.severity, category = EXCLUDED.category,
       rationale = EXCLUDED.rationale, suggestion = EXCLUDED.suggestion,
       is_active = true
     RETURNING id, phrase`,
    [e.phrase.trim(), e.severity ?? 'block', e.category ?? 'custom',
     e.rationale?.trim() || 'Added by a user of this site as a local editorial rule.',
     e.suggestion?.trim() || null, e.addedBy ?? 'user']);
  return rows[0];
}

export async function setLexiconActive(id: number, active: boolean) {
  await q(`UPDATE dm_jbook_lexicon SET is_active = $2 WHERE id = $1`, [id, active]);
}

/* ------------------------------------------------------------- the corpus -- */

export async function getSkeleton(exhibit = 'R-2') {
  return q<{ letter: string; title: string; isTable: boolean; sharePct: number;
             isRequired: boolean; seenCount: number; exhibitsTotal: number }>(
    `SELECT k.letter, k.title, k.is_table AS "isTable", k.share_pct AS "sharePct",
            k.is_required AS "isRequired", k.seen_count AS "seenCount",
            k.exhibits_total AS "exhibitsTotal"
       FROM dm_jbook_skeleton k JOIN dm_load l ON l.id = k.load_id AND l.is_current
      WHERE k.exhibit = $1 ORDER BY k.letter`, [exhibit]);
}

export async function getStyleProfiles(component?: string) {
  return q<{ component: string; fundLabel: string; letter: string; title: string;
             sampleSize: number; medianWords: number; minWords: number; maxWords: number;
             avgSentenceWords: number | null; exampleOpening: string | null }>(
    `SELECT s.component, s.fund_label AS "fundLabel", s.letter, s.title,
            s.sample_size AS "sampleSize", s.median_words AS "medianWords",
            s.min_words AS "minWords", s.max_words AS "maxWords",
            s.avg_sentence_words AS "avgSentenceWords",
            s.example_opening AS "exampleOpening"
       FROM dm_jbook_style s JOIN dm_load l ON l.id = s.load_id AND l.is_current
      WHERE ($1::text IS NULL OR s.component = $1)
      ORDER BY s.sample_size DESC, s.component, s.letter`, [component ?? null]);
}

export async function getComponents() {
  return q<{ component: string; fundLabel: string; exhibits: number; pbYear: number }>(
    `SELECT e.component, min(e.fund_label) AS "fundLabel", count(*)::int AS exhibits,
            max(e.pb_year) AS "pbYear"
       FROM dm_jbook_exhibit e JOIN dm_load l ON l.id = e.load_id AND l.is_current
      GROUP BY 1 ORDER BY 3 DESC`);
}

export async function getExemplars(component: string, letter: string, limit = 3) {
  return q<{ slug: string; pe: string | null; peTitle: string | null; body: string;
             wordCount: number; title: string }>(
    `SELECT s.slug, e.pe, e.pe_title AS "peTitle", s.body, s.word_count AS "wordCount", s.title
       FROM dm_jbook_section s
       JOIN dm_load l ON l.id = s.load_id AND l.is_current
       JOIN dm_jbook_exhibit e ON e.load_id = s.load_id AND e.slug = s.slug
      WHERE e.component = $1 AND s.letter = $2 AND NOT s.is_table
        AND s.word_count BETWEEN 80 AND 900
      ORDER BY s.word_count DESC LIMIT $3`, [component, letter, limit]);
}

/* ---------------------------------------------------------- the documents -- */

export interface DocSection { letter: string; title: string; isTable: boolean; body: string }

export async function listDocs() {
  return q<{ docKey: string; exhibit: string; pbYear: number; component: string;
             pe: string | null; peTitle: string | null; status: string;
             versions: number; updatedAt: string }>(
    `SELECT d.doc_key AS "docKey", d.exhibit, d.pb_year AS "pbYear", d.component,
            d.pe, d.pe_title AS "peTitle", d.status,
            (SELECT count(*)::int FROM dm_jbook_version v WHERE v.doc_key = d.doc_key) AS versions,
            to_char(d.updated_at,'YYYY-MM-DD HH24:MI') AS "updatedAt"
       FROM dm_jbook_doc d ORDER BY d.updated_at DESC`);
}

export async function getDoc(docKey: string) {
  const rows = await q(
    `SELECT d.*, to_char(d.updated_at,'YYYY-MM-DD HH24:MI') AS updated
       FROM dm_jbook_doc d WHERE d.doc_key = $1`, [docKey]);
  return rows[0] ?? null;
}

export async function getVersions(docKey: string) {
  return q<{ versionNo: number; note: string | null; author: string | null;
             origin: string; screenHits: number; wordCount: number; createdAt: string }>(
    `SELECT version_no AS "versionNo", note, author, origin,
            screen_hits AS "screenHits", word_count AS "wordCount",
            to_char(created_at,'YYYY-MM-DD HH24:MI') AS "createdAt"
       FROM dm_jbook_version WHERE doc_key = $1 ORDER BY version_no DESC`, [docKey]);
}

export async function getVersion(docKey: string, versionNo?: number) {
  const rows = await q(
    `SELECT version_no AS "versionNo", content, note, author, origin,
            screen_hits AS "screenHits", word_count AS "wordCount",
            to_char(created_at,'YYYY-MM-DD HH24:MI') AS "createdAt"
       FROM dm_jbook_version
      WHERE doc_key = $1 AND ($2::int IS NULL OR version_no = $2)
      ORDER BY version_no DESC LIMIT 1`, [docKey, versionNo ?? null]);
  return rows[0] ?? null;
}

export async function upsertDoc(d: Record<string, unknown>) {
  const rows = await q(
    `INSERT INTO dm_jbook_doc (doc_key, exhibit, pb_year, component, fund_label,
       appropriation_code, appropriation, budget_activity, budget_activity_title,
       pe, pe_title, project_number, project_title, r1_line, status, based_on_slug)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (doc_key) DO UPDATE SET
       exhibit=EXCLUDED.exhibit, pb_year=EXCLUDED.pb_year, component=EXCLUDED.component,
       fund_label=EXCLUDED.fund_label, appropriation_code=EXCLUDED.appropriation_code,
       appropriation=EXCLUDED.appropriation, budget_activity=EXCLUDED.budget_activity,
       budget_activity_title=EXCLUDED.budget_activity_title, pe=EXCLUDED.pe,
       pe_title=EXCLUDED.pe_title, project_number=EXCLUDED.project_number,
       project_title=EXCLUDED.project_title, r1_line=EXCLUDED.r1_line,
       status=EXCLUDED.status, based_on_slug=EXCLUDED.based_on_slug, updated_at=now()
     RETURNING doc_key AS "docKey"`,
    [d.docKey, d.exhibit ?? 'R-2', d.pbYear, d.component, d.fundLabel ?? 'RDT&E',
     d.appropriationCode ?? null, d.appropriation ?? null, d.budgetActivity ?? null,
     d.budgetActivityTitle ?? null, d.pe ?? null, d.peTitle ?? null,
     d.projectNumber ?? null, d.projectTitle ?? null, d.r1Line ?? null,
     d.status ?? 'draft', d.basedOnSlug ?? null]);
  return rows[0];
}

/** Save a new version. The version number is assigned here, never by the client. */
export async function saveVersion(docKey: string, content: unknown, opts: {
  note?: string; author?: string; origin?: string; screenHits?: number;
}) {
  const words = JSON.stringify(content).split(/\s+/).length;
  const rows = await q(
    `INSERT INTO dm_jbook_version (doc_key, version_no, content, note, author, origin,
                                   screen_hits, word_count)
     SELECT $1, coalesce(max(version_no), 0) + 1, $2::jsonb, $3, $4, $5, $6, $7
       FROM dm_jbook_version WHERE doc_key = $1
     RETURNING version_no AS "versionNo"`,
    [docKey, JSON.stringify(content), opts.note ?? null, opts.author ?? null,
     opts.origin ?? 'app', opts.screenHits ?? 0, words]);
  await q(`UPDATE dm_jbook_doc SET updated_at = now() WHERE doc_key = $1`, [docKey]);
  return rows[0];
}

export async function addUpload(docKey: string, u: {
  name: string; kind: string; content: string; rowCount?: number;
}) {
  const rows = await q(
    `INSERT INTO dm_jbook_upload (doc_key, name, kind, content, row_count)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [docKey, u.name, u.kind, u.content, u.rowCount ?? null]);
  return rows[0];
}

export async function getUploads(docKey: string) {
  return q<{ id: number; name: string; kind: string; content: string;
             rowCount: number | null; createdAt: string }>(
    `SELECT id, name, kind, content, row_count AS "rowCount",
            to_char(created_at,'YYYY-MM-DD HH24:MI') AS "createdAt"
       FROM dm_jbook_upload WHERE doc_key = $1 ORDER BY id DESC`, [docKey]);
}

/* ==========================================================================
 * THE BOOK GRAIN
 *
 * Everything above this line is the exhibit grain: the R-2 and R-2A exhibits
 * inside the current Defense-Wide RDT&E books, with their bodies.
 *
 * Everything below is the book grain: every justification book in the archive,
 * FY1998 to the current President's Budget, held at (book_key, pb_year) and
 * NEVER collapsed across pb_year. A book identity persists across editions --
 * `om/disaop5` is DISA's OP-5 in PB2012 and in PB2027 -- and each edition
 * restates its own format. That drift is the thing this corpus carries that no
 * single book does, and a query that groups it away is a defect. JB-01 blocks a
 * load where the extract has done it; these queries must not undo that.
 * ========================================================================== */

export interface JBook {
  bookKey: string; fundKey: string; fundLabel: string; title: string;
  files: number; yearsHeld: number; firstPbYear: number; latestPbYear: number;
  latestSourceFile: string | null; latestBookDate: string | null;
  pages: number; sections: number; timeSections: number; exhibits: string | null;
  hasText: boolean; isCurrent: boolean; fileNames: string | null; folder: string | null;
}

export interface JBookYear {
  pbYear: number; files: number; sourceFile: string | null; bookDate: string | null;
  pbBasis: string; pages: number; sections: number; titles: number; words: number;
  timeHits: number; timeSections: number; exhibits: string | null;
  recencyWeight: number; isLatest: boolean; hasText: boolean;
}

export interface JBookSkeletonRow {
  normTitle: string; title: string; shape: string; mark: string | null; level: number;
  exhibit: string | null; rank: number; yearsSeen: number; yearsTotal: number;
  firstSeenPb: number; lastSeenPb: number; sharePct: number; weightedSharePct: number;
  isRequired: boolean; isCurrent: boolean; medianWords: number | null;
  p10Words: number | null; p90Words: number | null;
  avgSentenceWords: number | null; timeSharePct: number | null;
}

export interface JBookExemplar {
  pbYear: number; normTitle: string; title: string; mark: string | null;
  sourceFile: string | null; pageNo: number | null; exhibit: string | null;
  words: number; avgSentenceWords: number | null; timeHits: number; body: string;
}

/** The appropriations the archive actually holds books for, with their counts. */
export async function getBookFunds() {
  return q<{ fundKey: string; fundLabel: string; books: number; editions: number;
             current: number; latestPbYear: number; firstPbYear: number; sortOrder: number }>(
    `SELECT b.fund_key AS "fundKey", min(b.fund_label) AS "fundLabel",
            count(*)::int AS books,
            sum(b.years_held)::int AS editions,
            count(*) FILTER (WHERE b.is_current)::int AS current,
            max(b.latest_pb_year) AS "latestPbYear", min(b.first_pb_year) AS "firstPbYear",
            min(b.sort_order) AS "sortOrder"
       FROM dm_jbook_book b JOIN dm_load l ON l.id = b.load_id AND l.is_current
      GROUP BY b.fund_key ORDER BY min(b.sort_order), count(*) DESC`);
}

/**
 * Books, optionally within one appropriation and matching a search.
 *
 * Ordered so the books a drafter is most likely to want come first: current
 * books before superseded ones, then the deepest history, then the title.
 */
export async function getBooks(opts: { fund?: string; q?: string; limit?: number } = {}) {
  return q<JBook>(
    `SELECT b.book_key AS "bookKey", b.fund_key AS "fundKey", b.fund_label AS "fundLabel",
            b.title, b.files, b.years_held AS "yearsHeld", b.first_pb_year AS "firstPbYear",
            b.latest_pb_year AS "latestPbYear", b.latest_source_file AS "latestSourceFile",
            b.latest_book_date AS "latestBookDate", b.pages, b.sections,
            b.time_sections AS "timeSections", b.exhibits, b.has_text AS "hasText",
            b.is_current AS "isCurrent", b.file_names AS "fileNames", b.folder
       FROM dm_jbook_book b JOIN dm_load l ON l.id = b.load_id AND l.is_current
      WHERE ($1::text IS NULL OR b.fund_key = $1)
        AND ($2::text IS NULL OR b.title ILIKE '%' || $2 || '%' OR b.book_key ILIKE '%' || $2 || '%'
             OR coalesce(b.file_names, '') ILIKE '%' || $2 || '%')
      ORDER BY b.is_current DESC, b.years_held DESC, b.title
      LIMIT $3`, [opts.fund ?? null, opts.q ?? null, opts.limit ?? 400]);
}

export async function getBook(bookKey: string): Promise<JBook | null> {
  const rows = await getBooksByKey([bookKey]);
  return rows[0] ?? null;
}

export async function getBooksByKey(keys: string[]) {
  if (!keys.length) return [];
  return q<JBook>(
    `SELECT b.book_key AS "bookKey", b.fund_key AS "fundKey", b.fund_label AS "fundLabel",
            b.title, b.files, b.years_held AS "yearsHeld", b.first_pb_year AS "firstPbYear",
            b.latest_pb_year AS "latestPbYear", b.latest_source_file AS "latestSourceFile",
            b.latest_book_date AS "latestBookDate", b.pages, b.sections,
            b.time_sections AS "timeSections", b.exhibits, b.has_text AS "hasText",
            b.is_current AS "isCurrent", b.file_names AS "fileNames", b.folder
       FROM dm_jbook_book b JOIN dm_load l ON l.id = b.load_id AND l.is_current
      WHERE b.book_key = ANY($1)`, [keys]);
}

/** Every edition of one book, newest first. The grain, unmodified. */
export async function getBookYears(bookKey: string) {
  return q<JBookYear>(
    `SELECT y.pb_year AS "pbYear", y.files, y.source_file AS "sourceFile",
            y.book_date AS "bookDate", y.pb_basis AS "pbBasis", y.pages, y.sections,
            y.titles, y.words, y.time_hits AS "timeHits", y.time_sections AS "timeSections",
            y.exhibits, y.recency_weight AS "recencyWeight", y.is_latest AS "isLatest",
            y.has_text AS "hasText"
       FROM dm_jbook_book_year y JOIN dm_load l ON l.id = y.load_id AND l.is_current
      WHERE y.book_key = $1 ORDER BY y.pb_year DESC`, [bookKey]);
}

/**
 * One book's own skeleton, measured across its own editions and weighted
 * towards recent ones. Ordered as the book prints it, not by frequency: the
 * order is part of the format.
 */
export async function getBookSkeleton(bookKey: string) {
  return q<JBookSkeletonRow>(
    `SELECT k.norm_title AS "normTitle", k.title, k.shape, k.mark, k.level, k.exhibit,
            k.rank, k.years_seen AS "yearsSeen", k.years_total AS "yearsTotal",
            k.first_seen_pb AS "firstSeenPb", k.last_seen_pb AS "lastSeenPb",
            k.share_pct AS "sharePct", k.weighted_share_pct AS "weightedSharePct",
            k.is_required AS "isRequired", k.is_current AS "isCurrent",
            k.median_words AS "medianWords", k.p10_words AS "p10Words", k.p90_words AS "p90Words",
            k.avg_sentence_words AS "avgSentenceWords", k.time_share_pct AS "timeSharePct"
       FROM dm_jbook_book_skeleton k JOIN dm_load l ON l.id = k.load_id AND l.is_current
      WHERE k.book_key = $1
      ORDER BY k.level, k.rank, k.norm_title`, [bookKey]);
}

/** What one edition printed, so a reader can see the format as at that year. */
export async function getBookSections(bookKey: string, pbYear: number) {
  return q<{ normTitle: string; title: string; shape: string; mark: string | null;
             level: number; exhibit: string | null; seq: number; firstPage: number | null;
             occurrences: number; medianWords: number; totalWords: number;
             avgSentenceWords: number | null; timeHits: number; moneyHits: number }>(
    `SELECT s.norm_title AS "normTitle", s.title, s.shape, s.mark, s.level, s.exhibit,
            s.seq, s.first_page AS "firstPage", s.occurrences,
            s.median_words AS "medianWords", s.total_words AS "totalWords",
            s.avg_sentence_words AS "avgSentenceWords", s.time_hits AS "timeHits",
            s.money_hits AS "moneyHits"
       FROM dm_jbook_book_section s JOIN dm_load l ON l.id = s.load_id AND l.is_current
      WHERE s.book_key = $1 AND s.pb_year = $2 ORDER BY s.seq`, [bookKey, pbYear]);
}

/**
 * Example passages. Held for current books only, and every one names the file
 * and page it came from -- a paragraph a drafter cannot trace back to a
 * published page is an anonymous piece of prose (JB-03).
 */
export async function getBookExemplars(bookKey: string, normTitle?: string, limit = 6) {
  return q<JBookExemplar>(
    `SELECT e.pb_year AS "pbYear", e.norm_title AS "normTitle", e.title, e.mark,
            e.source_file AS "sourceFile", e.page_no AS "pageNo", e.exhibit, e.words,
            e.avg_sentence_words AS "avgSentenceWords", e.time_hits AS "timeHits", e.body
       FROM dm_jbook_book_exemplar e JOIN dm_load l ON l.id = e.load_id AND l.is_current
      WHERE e.book_key = $1 AND ($2::text IS NULL OR e.norm_title = $2)
      ORDER BY e.pb_year DESC, e.words DESC LIMIT $3`,
    [bookKey, normTitle ?? null, limit]);
}

/**
 * Whether this database carries the book grain AND a load that filled it.
 *
 * The release order is migrate, refresh, deploy, and this is the guard for when
 * it is not followed: the site prerenders every page against the live database,
 * so a query naming dm_jbook_book before the migration has run would fail the
 * BUILD rather than a request. It does NOT fall back to the exhibit grain --
 * that is the aggregate this page was rebuilt to stop publishing, and a guard
 * that quietly restored it would hide exactly the defect it exists for. A
 * migrated-but-not-loaded database has the tables and no rows, which is the same
 * answer: the books are not available yet, and the page says so.
 */
export async function booksReady(): Promise<boolean> {
  try {
    const missing = await missingColumns('dm_jbook_book', ['book_key', 'fund_key', 'years_held']);
    if (missing.length) return false;
    const r = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM dm_jbook_book b
         JOIN dm_load l ON l.id = b.load_id AND l.is_current`);
    return (r[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/** The newest PB year anywhere in the corpus. */
export async function getLatestPbYear(): Promise<number | null> {
  const rows = await q<{ pb: number }>(
    `SELECT max(y.pb_year) AS pb FROM dm_jbook_book_year y
       JOIN dm_load l ON l.id = y.load_id AND l.is_current`);
  return rows[0]?.pb ?? null;
}
