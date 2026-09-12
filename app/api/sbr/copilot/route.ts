/**
 * The investigation copilot for one case, streamed.
 *
 * It is grounded on exactly the block `/api/sbr?action=context` returns, which
 * deterministic code assembled from the tested population. The model gets no
 * tools and no database. The context is sent to the browser FIRST, before a
 * token of the answer, for the same reason the chat sends its sources first: a
 * reader starts believing an answer as it arrives, so what it rests on has to
 * be on screen while that happens rather than appended after they have decided.
 *
 * Never logs a prompt or a completion.
 */
import { NextRequest, NextResponse } from 'next/server';
import { llmChainStream, llmStatus, llmConfigured, type LlmMessage } from '@/lib/llm';
import { buildContext, SBR_SYSTEM } from '@/lib/sbr-agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_QUESTION = 2_000;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string) {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || now > e.resetAt) { hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS }); return false; }
  e.count += 1;
  return e.count > RATE_LIMIT;
}

export async function GET() {
  if (!llmConfigured()) {
    return NextResponse.json({ configured: false, online: false,
      reason: 'No model is configured for this deployment.' });
  }
  return NextResponse.json(await llmStatus());
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 }); }

  const caseKey = String(body.case ?? '');
  const question = String(body.question ?? '').slice(0, MAX_QUESTION).trim();
  if (!caseKey) return NextResponse.json({ error: 'No case named.' }, { status: 400 });
  if (!question) return NextResponse.json({ error: 'No question asked.' }, { status: 400 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'Too many questions in a minute. Try again shortly.' },
      { status: 429 });
  }

  const ctx = await buildContext(caseKey);
  if (!ctx) return NextResponse.json({ error: 'No such case.' }, { status: 404 });

  const status = await llmStatus();
  if (!status.online) {
    return NextResponse.json({
      error: status.reason ?? 'No link in the model chain is answering.',
      offline: true,
      // The case page keeps working without a model; say so rather than
      // presenting an outage as a broken feature.
      hint: 'The evidence package and the test re-run are deterministic and still work.',
    }, { status: 503 });
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: SBR_SYSTEM },
    { role: 'user', content:
`A person working this case asks:

${question}

Answer only from the case facts below. If the facts do not contain what is needed, say which
record would have to be consulted and stop. Cite test codes when you rely on a finding.

CASE FACTS
${ctx.facts}` },
  ];

  const encoder = new TextEncoder();
  const send = (c: ReadableStreamDefaultController, event: string, data: unknown) =>
    c.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

  const stream = new ReadableStream({
    async start(controller) {
      try {
        send(controller, 'context', { header: ctx.header, facts: ctx.facts });
        for await (const ev of llmChainStream(messages, { temperature: 0.2, numCtx: 16384 })) {
          if (ev.type === 'link') {
            send(controller, 'link', { id: ev.link.id, label: ev.link.label,
              model: ev.link.model, isLocal: ev.link.isLocal });
          } else if (ev.type === 'delta') {
            send(controller, 'delta', { text: ev.text });
          } else if (ev.type === 'fallback') {
            send(controller, 'fallback', { from: ev.from.label, reason: ev.reason });
          } else if (ev.type === 'done') {
            send(controller, 'done', { link: ev.link.label, ms: ev.ms });
          } else if (ev.type === 'failed') {
            send(controller, 'failed', { reason: ev.reason });
          }
        }
      } catch (e: any) {
        send(controller, 'failed', { reason: e?.message ?? 'The stream ended unexpectedly.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
