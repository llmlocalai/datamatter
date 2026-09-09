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
