/**
 * The local model server.
 *
 * The models that know this material are on a Mac Studio, not on Vercel, and a
 * Vercel function cannot reach a machine on somebody's network. So the site
 * talks to whatever public hostname fronts that machine -- a Cloudflare tunnel
 * or a Tailscale funnel -- and this module is the only place that knows how.
 *
 * THREE RULES HOLD HERE.
 *
 * 1. NOTHING IS LOGGED. Not a prompt, not a completion, not a key. The footer of
 *    this site says no controlled unclassified information is present on it and
 *    none transits it; a console.log of a user's question in a Vercel function
 *    is a log line in somebody else's datacentre, and would make that sentence
 *    false. Errors report the STATUS, never the body.
 *
 * 2. THE MODEL IS CHOSEN FROM WHAT THE SERVER OFFERS. A model name arriving
 *    from the browser is checked against the tag list the server itself
 *    publishes before it is used, because Ollama will happily accept a name it
 *    does not have and start pulling gigabytes over somebody's home connection.
 *
 * 3. OFFLINE IS A NORMAL STATE, NOT AN ERROR. The Mac is asleep, the tunnel is
 *    down, the laptop moved. The page says so plainly and keeps working for
 *    everything that does not need the model.
 */

export interface LlmModel { name: string; family: string | null; size: number | null;
                            parameters: string | null; quantisation: string | null }

export interface LlmStatus {
  configured: boolean;
  online: boolean;
  models: LlmModel[];
  defaultModel: string | null;
  host: string | null;        // hostname only, never the key
  checkedAt: string;
  reason?: string;
}

export interface LlmMessage { role: 'system' | 'user' | 'assistant'; content: string }

const DEFAULT_TIMEOUT = Number(process.env.LLM_TIMEOUT_MS ?? 120_000);
const HEALTH_TIMEOUT = 6_000;

export function llmConfigured(): boolean {
  return !!process.env.LLM_BASE_URL;
}

function base(): string {
  const b = process.env.LLM_BASE_URL ?? '';
  return b.replace(/\/+$/, '');
}

/** Auth headers. Bearer for a reverse proxy that checks one; Cloudflare Access
 *  service tokens for a tunnel that does. Both are optional and neither is ever
 *  returned to a caller. */
function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (process.env.LLM_API_KEY) h.Authorization = `Bearer ${process.env.LLM_API_KEY}`;
  if (process.env.LLM_ACCESS_CLIENT_ID && process.env.LLM_ACCESS_CLIENT_SECRET) {
    h['CF-Access-Client-Id'] = process.env.LLM_ACCESS_CLIENT_ID;
    h['CF-Access-Client-Secret'] = process.env.LLM_ACCESS_CLIENT_SECRET;
  }
  return h;
}

function hostOf(): string | null {
  try { return new URL(base()).host; } catch { return null; }
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await run(c.signal); } finally { clearTimeout(t); }
}

/**
 * What the server has, or why it cannot be reached.
 *
 * `reason` is written for a reader of the page, not for a log: "the model server
 * did not answer" is what a person needs, and the status code is enough detail
 * to act on without repeating whatever the far end said.
 */
export async function llmStatus(): Promise<LlmStatus> {
  const checkedAt = new Date().toISOString();
  if (!llmConfigured()) {
    return { configured: false, online: false, models: [], defaultModel: null,
      host: null, checkedAt,
      reason: 'No model server is configured for this deployment (LLM_BASE_URL is unset).' };
  }
  try {
    const res = await withTimeout(HEALTH_TIMEOUT, (signal) =>
      fetch(`${base()}/api/tags`, { headers: authHeaders(), signal, cache: 'no-store' }));
    if (!res.ok) {
      return { configured: true, online: false, models: [], defaultModel: null,
        host: hostOf(), checkedAt,
        reason: res.status === 401 || res.status === 403
          ? 'The model server refused this deployment’s credentials.'
          : `The model server answered ${res.status}.` };
    }
    const body = await res.json() as { models?: { name?: string; model?: string; size?: number;
      details?: { family?: string; parameter_size?: string; quantization_level?: string } }[] };
    const models: LlmModel[] = (body.models ?? []).map((m) => ({
      name: m.name ?? m.model ?? '',
      family: m.details?.family ?? null,
      size: m.size ?? null,
      parameters: m.details?.parameter_size ?? null,
      quantisation: m.details?.quantization_level ?? null,
    })).filter((m) => m.name);
    // Largest first: the two big models are the ones that know this material,
    // and a picker that opens on a 1B model makes the feature look broken.
    models.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
    const preferred = process.env.LLM_MODEL;
    const defaultModel = (preferred && models.some((m) => m.name === preferred))
      ? preferred : (models[0]?.name ?? null);
    return { configured: true, online: models.length > 0, models, defaultModel,
      host: hostOf(), checkedAt,
      reason: models.length ? undefined : 'The model server is reachable but has no models loaded.' };
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError';
    return { configured: true, online: false, models: [], defaultModel: null,
      host: hostOf(), checkedAt,
      reason: aborted
        ? 'The model server did not answer within six seconds — the machine is probably asleep.'
        : 'The model server could not be reached.' };
  }
}

/** Resolve a requested model against what the server actually has. */
export function pickModel(requested: string | undefined, status: LlmStatus): string | null {
  if (requested && status.models.some((m) => m.name === requested)) return requested;
  return status.defaultModel;
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  numCtx?: number;
  signal?: AbortSignal;
}

/**
 * Stream a chat completion as it is generated.
 *
 * Ollama returns newline-delimited JSON; this yields the text deltas. The caller
 * decides what to do with them, which keeps the route free to add its own
 * framing (sources first, then the answer) without this module knowing about
 * HTTP at all.
 */
export async function* llmChatStream(messages: LlmMessage[], opts: ChatOptions)
    : AsyncGenerator<{ delta?: string; done?: boolean; evalCount?: number }> {
  const res = await withTimeout(DEFAULT_TIMEOUT, (signal) =>
    fetch(`${base()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        model: opts.model, messages, stream: true,
        options: { temperature: opts.temperature ?? 0.2, num_ctx: opts.numCtx ?? 8192 },
      }),
      signal: opts.signal ?? signal,
      cache: 'no-store',
    }));
  if (!res.ok || !res.body) {
    throw new Error(`model server answered ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean;
                                          eval_count?: number };
        if (obj.message?.content) yield { delta: obj.message.content };
        if (obj.done) yield { done: true, evalCount: obj.eval_count };
      } catch {
        // A partial line is normal at a chunk boundary; it is completed by the
        // next read. Anything else is skipped rather than logged.
      }
    }
  }
}

/** The whole completion, for callers that cannot stream (a revision, a draft). */
export async function llmChat(messages: LlmMessage[], opts: ChatOptions): Promise<string> {
  let out = '';
  for await (const part of llmChatStream(messages, opts)) {
    if (part.delta) out += part.delta;
  }
  return out;
}
