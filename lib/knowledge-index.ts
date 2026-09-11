/**
 * The BM25 index over the curated DoD-FM knowledge wiki.
 *
 * This was inside app/api/regulation/route.ts, where it served one endpoint.
 * The chat needs the same retrieval -- the same passages, the same authority
 * re-rank, the same scores -- so it lives here and both call it. Two BM25
 * implementations over one index would drift, and the day they disagreed the
 * chat would cite a passage the search page ranks fourth.
 *
 * The index (app/api/data/knowledge_index.json, ~400KB) is pre-built by
 * scripts/etl_knowledge_index.py and is the only data file that ships with the
 * app rather than living in Neon, because /regulation scores in the browser.
 */
import fs from 'fs';
import path from 'path';

export interface KnowledgeDoc {
  id: string; page: string; title: string; section: string; text: string;
  source: string; authority: number; len: number; tf: Record<string, number>;
}

export interface KnowledgeIndex {
  doc_count: number; avg_doc_len: number; params: { k1: number; b: number };
  idf: Record<string, number>; docs: KnowledgeDoc[];
}

const DATA_PATH = path.join(process.cwd(), 'app', 'api', 'data');
const INDEX_FILE = 'knowledge_index.json';

// Cached at module scope so a warm serverless instance parses the file once.
// This does not survive a cold start and is not shared across instances.
let cachedIndex: KnowledgeIndex | null = null;

export function loadKnowledgeIndex(): KnowledgeIndex {
  if (cachedIndex) return cachedIndex;
  const raw = fs.readFileSync(path.join(DATA_PATH, INDEX_FILE), 'utf-8');
  cachedIndex = JSON.parse(raw) as KnowledgeIndex;
  return cachedIndex;
}

const TOKEN_RE = /[a-z0-9]+/g;
const STOP = new Set(
  'a an the of and or to in on for is are was were be been with as by at from that this it its into over under than when which do does have has will would can could should may might not no we our you they them their up out about after before if so very also just more most less many much each other all any some'
    .split(' ')
);

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(TOKEN_RE) || []).filter((t) => !STOP.has(t) && t.length > 1);
}

/** BM25 with an authority multiplier, so primary regulation outranks commentary. */
export function bm25(doc: KnowledgeDoc, qterms: string[], idf: Record<string, number>,
                     k1: number, b: number, avgLen: number): number {
  let score = 0;
  for (const t of qterms) {
    const tf = doc.tf[t];
    if (!tf) continue;
    const denom = tf + k1 * (1 - b + b * (doc.len / avgLen));
    score += (idf[t] ?? 0) * (tf * (k1 + 1)) / denom;
  }
  return score * doc.authority;
}

export interface KnowledgeHit {
  page: string; section: string; text: string; source: string;
  authority: number; score: number;
}

export function searchKnowledge(query: string, topK = 8): KnowledgeHit[] {
  const index = loadKnowledgeIndex();
  const qterms = tokenize(query);
  if (!qterms.length) return [];
  const { k1, b } = index.params;
  return index.docs
    .map((d) => ({ doc: d, score: bm25(d, qterms, index.idf, k1, b, index.avg_doc_len) }))
    .filter((r) => r.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, topK)
    .map((r) => ({
      page: r.doc.page, section: r.doc.section, text: r.doc.text, source: r.doc.source,
      authority: r.doc.authority, score: +r.score.toFixed(4),
    }));
}

export function knowledgeCorpus() {
  const index = loadKnowledgeIndex();
  return { docCount: index.doc_count, termCount: Object.keys(index.idf).length };
}
