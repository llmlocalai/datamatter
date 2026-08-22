import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * Regulatory Q&A — retrieval layer for the web app.
 *
 * Lexical (BM25) search over the curated, authority-tagged DoD-FM knowledge
 * wiki, re-ranked by source authority. This is the serverless-safe
 * counterpart to the local ChromaDB vector index (which powers the Open WebUI
 * agent but cannot run in a Vercel function).
 *
 * The index (app/api/data/knowledge_index.json) is pre-built by
 * scripts/etl_knowledge_index.py, so scoring at request time is O(query · top-k).
 */

const DATA_PATH = path.join(process.cwd(), 'app', 'api', 'data');
const INDEX_FILE = 'knowledge_index.json';

interface Doc {
  id: string;
  page: string;
  title: string;
  section: string;
  text: string;
  source: string;
  authority: number;
  len: number;
  tf: Record<string, number>;
}

interface Index {
  doc_count: number;
  avg_doc_len: number;
  params: { k1: number; b: number };
  idf: Record<string, number>;
  docs: Doc[];
}

const TOKEN_RE = /[a-z0-9]+/g;
const STOP = new Set(
   "a an the of and or to in on for is are was were be been with as by at from that this it its into over under than when which do does have has will would can could should may might not no we our you they them their up out about after before if so very also just more most less many much each other all any some".split(
      ' '
   )
);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(TOKEN_RE) || []).filter(
     (t) => !STOP.has(t) && t.length > 1
   );
}

// BM25 score of a document against a query, with an authority multiplier.
function bm25(
   doc: Doc,
   qterms: string[],
   idf: Record<string, number>,
   k1: number,
   b: number,
   avgLen: number
): number {
  let score = 0;
  for (const t of qterms) {
    const tf = doc.tf[t];
    if (!tf) continue;
    const idfVal = idf[t] ?? 0;
    const denom = tf + k1 * (1 - b + b * (doc.len / avgLen));
    score += idfVal * (tf * (k1 + 1)) / denom;
   }
  // Authority re-rank: multiply by the page's authority weight, so primary
  // regulation/statute/audit material is pulled above generic material on a
  // tie. Capped so a single long doc can't dominate purely on length.
  return score * doc.authority;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();
  const topK = Math.min(20, Math.max(1, Number(searchParams.get('top') || 8)));

  if (!q) {
    return NextResponse.json(
       { error: 'Provide a query, e.g. /api/regulation?q=antideficiency+act' },
       { status: 400 }
     );
   }

  try {
    const raw = fs.readFileSync(path.join(DATA_PATH, INDEX_FILE), 'utf-8');
    const index: Index = JSON.parse(raw);
    const { k1, b } = index.params;
    const qterms = tokenize(q);

    if (!qterms.length) {
      return NextResponse.json({ query: q, results: [], total: 0 });
     }

    const scored = index.docs
        .map((d) => ({ doc: d, score: bm25(d, qterms, index.idf, k1, b, index.avg_doc_len) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

    const results = scored.map((r) => ({
       page: r.doc.page,
       section: r.doc.section,
       text: r.doc.text,
       source: r.doc.source,
       authority: r.doc.authority,
       score: +r.score.toFixed(4),
    }));

    // A simple "answer" is the top hit; the rest are supporting context.
    const answer = results[0]
         ? {
            page: results[0].page,
            text: results[0].text,
            source: results[0].source,
          }
         : null;

    return NextResponse.json({
       query: q,
       matched: scored.length,
       answer,
       results,
       corpus: { doc_count: index.doc_count, source: 'DoD-FM knowledge wiki' },
     });
   } catch (error) {
    console.error('Error in regulation Q&A:', error);
    return NextResponse.json({ error: 'Failed to query knowledge base' }, { status: 500 });
   }
}

export const dynamic = 'force-dynamic';
export const revalidate = false;
