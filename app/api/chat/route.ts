/**
 * The chat endpoint: this site's data, the Mac Studio's models.
 *
 * GET  -> what the model server has, or why it cannot be reached.
 * POST -> a streamed answer, with the sources sent FIRST.
 *
 * Sources first is deliberate. The answer streams in over several seconds and a
 * reader starts believing it immediately; the citations have to be on screen
 * while that happens, not appended once the reader has already decided. It also
 * means a question that retrieves nothing is visibly a question that retrieved
 * nothing, before a word of the answer arrives.
 *
 * This route never logs a prompt or a completion. See lib/llm.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { llmStatus, llmChainStream, llmConfigured, type LlmMessage } from '@/lib/llm';
import { buildAskContext } from '@/lib/ask';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_QUESTION = 4_000;      // characters
const MAX_TURNS = 12;            // messages of history carried back to the model
const RATE_LIMIT = 12;           // requests per minute per instance
const RATE_WINDOW_MS = 60_000;

const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || now > e.resetAt) { hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS }); return false; }
  e.count += 1;
  return e.count > RATE_LIMIT;
}

// The tag list changes when somebody pulls a model, not between requests, so it
// is cached briefly. A stale-by-20-seconds model list is not worth a round trip
// to somebody's house on every keystroke of a health check.
let statusCache: { at: number; value: Awaited<ReturnType<typeof llmStatus>> } | null = null;
async function cachedStatus(maxAgeMs = 20_000) {
  if (statusCache && Date.now() - statusCache.at < maxAgeMs) return statusCache.value;
  const value = await llmStatus();
  statusCache = { at: Date.now(), value };
  return value;
}

export async function GET() {
  const status = await cachedStatus();
  // No hostname and no key ever reach the browser. This is a public site and the
  // first two links are somebody's own machine behind a funnel: publishing where
  // it is invites traffic that has nothing to do with this page. What a visitor
  // needs is which links exist, which one is answering, and why the others are not.
  return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
}

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  const client = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (rateLimited(client)) {
    return NextResponse.json({ error: 'Too many questions in a minute. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': '60' } });
  }

  let body: { messages?: { role: string; content: string }[]; link?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'body must be JSON' }, { status: 400 }); }

  const history = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_TURNS);
  const question = history.filter((m) => m.role === 'user').slice(-1)[0]?.content?.trim() ?? '';
  if (!question) return NextResponse.json({ error: 'Ask a question.' }, { status: 400 });
  if (question.length > MAX_QUESTION) {
    return NextResponse.json({
      error: `That is ${question.length.toLocaleString()} characters; the limit is `
        + `${MAX_QUESTION.toLocaleString()}. Ask about a part of it.` }, { status: 413 });
  }

  if (!llmConfigured()) {
    return NextResponse.json({
      error: 'No model is configured for this deployment, so the chat cannot answer. '
        + 'Everything else on the site works; the search on /regulation is the retrieval half '
        + 'of this feature and needs no model.' }, { status: 503 });
  }
  const status = await cachedStatus(5_000);
  if (!status.online) {
    return NextResponse.json({ error: status.reason ?? 'No model in the chain is answering.',
      links: status.links }, { status: 503 });
  }

  const { system, context, sources } = await buildAskContext(question);
  const messages: LlmMessage[] = [
    { role: 'system', content: system },
    { role: 'system', content: context ? `CONTEXT\n${context}` : 'CONTEXT\n(nothing retrieved)' },
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(sse('sources', { sources, retrieved: sources.length }));
      try {
        for await (const ev of llmChainStream(messages, { only: body.link })) {
          // Which link is answering is sent as it happens, not at the end: an
          // answer from the commercial fallback is a different artifact from one
          // by the tuned local model, and a reader has to be able to tell while
          // they are reading it rather than afterwards.
          if (ev.type === 'link') {
            controller.enqueue(sse('link', { id: ev.link.id, label: ev.link.label,
              isLocal: ev.link.isLocal }));
          }
          if (ev.type === 'fallback') {
            controller.enqueue(sse('fallback', { from: ev.from.id, label: ev.from.label,
              reason: ev.reason }));
          }
          if (ev.type === 'delta') controller.enqueue(sse('delta', { t: ev.text }));
          if (ev.type === 'done') {
            controller.enqueue(sse('done', { ms: ev.ms, id: ev.link.id, label: ev.link.label,
              isLocal: ev.link.isLocal }));
          }
          if (ev.type === 'failed') controller.enqueue(sse('error', { error: ev.reason }));
        }
      } catch {
        controller.enqueue(sse('error', {
          error: 'The model chain stopped answering part-way through.' }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
    },
  });
}
