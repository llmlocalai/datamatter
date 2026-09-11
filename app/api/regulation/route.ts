import { NextResponse } from 'next/server';
import { loadKnowledgeIndex, searchKnowledge } from '@/lib/knowledge-index';

/**
 * Regulatory Q&A -- retrieval layer for the web app.
 *
 * Lexical (BM25) search over the curated, authority-tagged DoD-FM knowledge
 * wiki, re-ranked by source authority. This is the serverless-safe counterpart
 * to the local ChromaDB vector index (which powers the Open WebUI agent but
 * cannot run in a Vercel function).
 *
 * The scoring itself lives in lib/knowledge-index.ts because the landing-page
 * chat retrieves from the same index: two implementations would drift, and the
 * day they disagreed this page and the chat would cite different passages for
 * the same question.
 *
 * Rate limiting below is an in-memory token count, scoped to one serverless
 * instance. It throttles abusive traffic to a single warm instance; it is not a
 * distributed rate limit and must not be relied on as one under multi-instance
 * load.
 */

const RATE_LIMIT = 30;            // requests
const RATE_WINDOW_MS = 60_000;    // per minute, per instance
const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();
  const topK = Math.min(20, Math.max(1, Number(searchParams.get('top') || 8)));

  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (rateLimited(client)) {
    return NextResponse.json(
       { error: 'Too many requests. Try again in a moment.' },
       { status: 429, headers: { 'Retry-After': '60' } }
     );
   }

  if (!q) {
    return NextResponse.json(
       { error: 'Provide a query, e.g. /api/regulation?q=antideficiency+act' },
       { status: 400 }
     );
   }

  try {
    const index = loadKnowledgeIndex();
    const results = searchKnowledge(q, topK);
    if (!results.length) {
      return NextResponse.json({ query: q, results: [], total: 0 });
     }
    const scored = results;

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
