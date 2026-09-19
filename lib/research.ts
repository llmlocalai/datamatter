/**
 * The research paper (/research).
 *
 * The paper's sentences are written by hand, once, in
 * database/seed_research.json, and they contain NO NUMBERS. Every figure is a
 * named placeholder resolved at extract time from the same staged extracts that
 * feed the rest of the site, and RES-01 -- a critical control, so it rolls the
 * load back -- fails a load where a placeholder does not resolve or a
 * recommendation names a finding that does not exist.
 *
 * That separation is the only thing that keeps a written argument honest over
 * time. A number typed into a sentence stops being checkable the moment it is
 * typed; it does not move when the data moves, and it fails silently, reading
 * exactly like a current figure. A placeholder fails loudly.
 *
 * This module therefore does no arithmetic. It reads the three tables and
 * renders the paper's own figures into its own prose. A figure with no evidence
 * row behind it is left as its brace rather than blanked, because the load
 * should have caught it and a visible brace is how a reader learns it did not.
 */
import { query } from './db';
import { missingColumns } from './schema';

export type ResearchFinding = {
  findingKey: string; sortOrder: number; title: string; claim: string;
  soWhat: string; falsifier: string; confidence: string;
  sourcePages: string[]; placeholders: string[];
};

export type Audience = 'department' | 'service' | 'appropriator';

export type ResearchRecommendation = {
  recKey: string; audience: Audience; sortOrder: number; title: string;
  action: string; becauseFinding: string; cost: string | null;
  measure: string | null; authority: string | null; horizon: string | null;
};

export type ResearchEvidence = {
  evidenceKey: string; value: number | null; display: string; unit: string;
  label: string; source: string; fiscalYear: number | null;
};

const CUR = (a: string) => `JOIN dm_load l ON l.id = ${a}.load_id AND l.is_current`;

/** Migrated AND loaded, both halves. A paper whose evidence table is empty
 *  would render every sentence as braces, which is worse than not rendering. */
export async function researchReady(): Promise<boolean> {
  try {
    const missing = await Promise.all([
      missingColumns('dm_research_finding', ['claim', 'falsifier', 'placeholders']),
      missingColumns('dm_research_recommendation', ['because_finding', 'audience', 'horizon']),
      missingColumns('dm_research_evidence', ['display', 'unit', 'source']),
    ]);
    if (missing.some((m) => m.length)) return false;
    const r = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM dm_research_evidence e
         JOIN dm_load l ON l.id = e.load_id AND l.is_current`);
    return (r[0]?.n ?? 0) > 0;
  } catch { return false; }
}

function jsonArray(s: string | null): string[] {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

export async function getFindings(): Promise<ResearchFinding[]> {
  const rows = await query<any>(
    `SELECT f.finding_key, f.sort_order, f.title, f.claim, f.so_what, f.falsifier,
            f.confidence, f.source_pages, f.placeholders
       FROM dm_research_finding f ${CUR('f')}
      ORDER BY f.sort_order, f.finding_key`);
  return rows.map((r) => ({
    findingKey: r.finding_key, sortOrder: r.sort_order, title: r.title, claim: r.claim,
    soWhat: r.so_what, falsifier: r.falsifier, confidence: r.confidence,
    sourcePages: jsonArray(r.source_pages), placeholders: jsonArray(r.placeholders),
  }));
}

export async function getRecommendations(): Promise<ResearchRecommendation[]> {
  const rows = await query<any>(
    `SELECT r.rec_key, r.audience, r.sort_order, r.title, r.action, r.because_finding,
            r.cost, r.measure, r.authority, r.horizon
       FROM dm_research_recommendation r ${CUR('r')}
      ORDER BY r.audience, r.sort_order, r.rec_key`);
  return rows.map((r) => ({
    recKey: r.rec_key, audience: r.audience, sortOrder: r.sort_order, title: r.title,
    action: r.action, becauseFinding: r.because_finding, cost: r.cost,
    measure: r.measure, authority: r.authority, horizon: r.horizon,
  }));
}

export async function getEvidence(): Promise<ResearchEvidence[]> {
  const rows = await query<any>(
    `SELECT e.evidence_key, e.value, e.display, e.unit, e.label, e.source, e.fiscal_year
       FROM dm_research_evidence e ${CUR('e')}
      ORDER BY e.id`);
  return rows.map((r) => ({
    evidenceKey: r.evidence_key, value: r.value === null ? null : Number(r.value),
    display: r.display, unit: r.unit, label: r.label, source: r.source,
    fiscalYear: r.fiscal_year,
  }));
}

export type EvidenceMap = Record<string, ResearchEvidence>;

export function evidenceMap(rows: ResearchEvidence[]): EvidenceMap {
  const m: EvidenceMap = {};
  for (const r of rows) m[r.evidenceKey] = r;
  return m;
}

/**
 * Split a sentence into plain runs and figure runs, so the page can mark the
 * figures up rather than flattening them into the text. An unresolved
 * placeholder comes back as a plain run still wearing its braces: the load
 * should have refused it, and hiding it here would hide a broken control.
 */
export type Run = { text: string; evidence?: ResearchEvidence };

const FIG = /\{([a-z0-9_]+)\}/g;

export function runs(text: string, ev: EvidenceMap): Run[] {
  const out: Run[] = [];
  const re = new RegExp(FIG.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const e = ev[m[1]];
    out.push(e ? { text: e.display, evidence: e } : { text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export const AUDIENCE_LABEL: Record<Audience, string> = {
  department: 'For the Department',
  service: 'For the military departments and defense agencies',
  appropriator: 'For the appropriations committees',
};

export const AUDIENCE_WHO: Record<Audience, string> = {
  department: 'OUSD(Comptroller) and the Deputy Secretary',
  service: 'Component comptrollers and major command resource managers',
  appropriator: 'House and Senate Appropriations Committees, Defense Subcommittees',
};
