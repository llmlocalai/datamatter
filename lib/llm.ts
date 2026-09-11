/**
 * The model chain.
 *
 * Three links, tried in order, and the order is the point:
 *
 *   1. the big local model on the Mac Studio  (default)
 *   2. the smaller local model on the same machine
 *   3. a commercial model, over the public internet
 *
 * The first two are the ones trained on this material and they cost nothing to
 * run; the third is a paid API and a different company's servers. So the chain
 * only ever moves DOWN it, never up, and every answer says which link produced
 * it — an answer from the cloud model is not the same artifact as an answer
 * from the tuned local one, and a reader who cannot tell them apart is being
 * misled about where the sentence came from.
 *
 * FOUR RULES HOLD HERE.
 *
 * 1. NOTHING IS LOGGED. Not a prompt, not a completion, not a key. The footer of
 *    this site says no controlled unclassified information is present on it and
 *    none transits it; a console.log of a user's question in a Vercel function
 *    is a log line in somebody else's datacentre, and would make that sentence
 *    false. Errors report the STATUS, never the body.
 *
 * 2. FALLBACK HAPPENS BEFORE THE FIRST TOKEN, NEVER AFTER IT. Once a link has
 *    emitted text the reader is already reading it; silently restarting on a
 *    second model would rewrite a paragraph under their eyes. A failure after
 *    the first token is reported as a truncated answer, which is what it is.
 *
 * 3. A LOCAL MODEL IS USED ONLY IF THE SERVER SAYS IT HAS IT. Ollama accepts a
 *    tag it does not hold and starts pulling gigabytes over somebody's home
 *    connection, so the tag is checked against /api/tags first and a missing
 *    model is a reason to move down the chain, not to start a download.
 *
 * 4. THE CLOUD LINK IS OPT-IN AND VISIBLE. It exists only when a key is
 *    configured, it is always last, and the page names it when it answers.
 */

export type LinkKind = 'ollama' | 'openai';

export interface LlmLink {
  id: string;
  kind: LinkKind;
  label: string;          // what the page calls it
  model: string;          // the tag or model id sent to the server
  baseUrl: string;
  isLocal: boolean;
  timeoutMs: number;
  headers: Record<string, string>;
}

export interface LinkStatus {
  id: string; label: string; model: string; isLocal: boolean;
  state: 'ready' | 'unreachable' | 'model-missing' | 'refused' | 'unconfigured';
  detail?: string;
  /** Tags the local server actually holds, when it answered. */
  available?: string[];
}

export interface LlmStatus {
  configured: boolean;
  online: boolean;                 // at least one link is ready
  links: LinkStatus[];
  defaultLink: string | null;
  checkedAt: string;
  reason?: string;
}

export interface LlmMessage { role: 'system' | 'user' | 'assistant'; content: string }

const LOCAL_TIMEOUT = Number(process.env.LLM_TIMEOUT_MS ?? 120_000);
const CLOUD_TIMEOUT = Number(process.env.LLM_CLOUD_TIMEOUT_MS ?? 60_000);
const HEALTH_TIMEOUT = Number(process.env.LLM_HEALTH_TIMEOUT_MS ?? 6_000);

const trim = (s: string) => s.replace(/\/+$/, '');

/**
 * The shared secret goes on both a Bearer header and an X-LLM-Secret header.
 *
 * Tailscale Funnel puts the machine on the public internet and Ollama has no
 * authentication of its own, so SOMETHING in front of it has to check a secret.
 * Which header that something looks at depends on what is in front — a small
 * reverse proxy, Caddy's forward_auth, an OpenAI-compatible shim — so both are
 * sent rather than making the choice of proxy a code change here. Neither is
 * ever returned to a caller.
 */
function localHeaders(): Record<string, string> {
  const secret = process.env.LOCAL_LLM_SHARED_SECRET ?? process.env.LLM_API_KEY ?? '';
  const h: Record<string, string> = {};
  if (secret) {
    h.Authorization = `Bearer ${secret}`;
    h['X-LLM-Secret'] = secret;
  }
  // A Cloudflare Access service token, for a tunnel fronted that way instead.
  if (process.env.LLM_ACCESS_CLIENT_ID && process.env.LLM_ACCESS_CLIENT_SECRET) {
    h['CF-Access-Client-Id'] = process.env.LLM_ACCESS_CLIENT_ID;
    h['CF-Access-Client-Secret'] = process.env.LLM_ACCESS_CLIENT_SECRET;
  }
  return h;
}

/** The chain, in order, from the environment. Absent links are simply absent. */
export function llmChain(): LlmLink[] {
  const chain: LlmLink[] = [];
  const localBase = process.env.LOCAL_LLM_FUNNEL_URL ?? process.env.LLM_BASE_URL ?? '';
  const primary = process.env.LOCAL_LLM_MODEL_PRIMARY ?? process.env.LLM_MODEL ?? '';
  const secondary = process.env.LOCAL_LLM_MODEL_SECONDARY ?? '';
  if (localBase && primary) {
    chain.push({ id: 'local-primary', kind: 'ollama', label: primary, model: primary,
      baseUrl: trim(localBase), isLocal: true, timeoutMs: LOCAL_TIMEOUT, headers: localHeaders() });
  }
  if (localBase && secondary && secondary !== primary) {
    chain.push({ id: 'local-secondary', kind: 'ollama', label: secondary, model: secondary,
      baseUrl: trim(localBase), isLocal: true, timeoutMs: LOCAL_TIMEOUT, headers: localHeaders() });
  }
  const cloudKey = process.env.CLOUD_LLM_API_KEY ?? process.env.GEMINI_API_KEY
    ?? process.env.OPENAI_API_KEY ?? '';
  const cloudModel = process.env.CLOUD_LLM_MODEL ?? '';
  const cloudBase = process.env.CLOUD_LLM_BASE_URL
    ?? 'https://generativelanguage.googleapis.com/v1beta/openai';
  if (cloudKey && cloudModel) {
    chain.push({ id: 'cloud', kind: 'openai', label: cloudModel, model: cloudModel,
      baseUrl: trim(cloudBase), isLocal: false, timeoutMs: CLOUD_TIMEOUT,
      headers: { Authorization: `Bearer ${cloudKey}` } });
  }
  return chain;
}

export function llmConfigured(): boolean {
  return llmChain().length > 0;
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await run(c.signal); } finally { clearTimeout(t); }
}

/**
 * Does this Ollama server hold this tag?
 *
 * Tolerant about the two spellings people actually use — `qwen3.8:27b-q8` and
 * `qwen3.8:27b-q8:latest` are the same model — and about nothing else. A tag
 * that is merely SIMILAR is a different model and is not substituted.
 */
function tagPresent(want: string, have: string[]): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/:latest$/, '');
  const w = norm(want);
  return have.some((h) => norm(h) === w);
}

async function probeOllama(link: LlmLink): Promise<LinkStatus> {
  const base = { id: link.id, label: link.label, model: link.model, isLocal: link.isLocal };
  try {
    const res = await withTimeout(HEALTH_TIMEOUT, (signal) =>
      fetch(`${link.baseUrl}/api/tags`, { headers: link.headers, signal, cache: 'no-store' }));
    if (res.status === 401 || res.status === 403) {
      return { ...base, state: 'refused',
        detail: 'The model server refused this deployment’s shared secret.' };
    }
    if (!res.ok) {
      return { ...base, state: 'unreachable', detail: `The model server answered ${res.status}.` };
    }
    const body = await res.json() as { models?: { name?: string; model?: string }[] };
    const have = (body.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean);
    if (!tagPresent(link.model, have)) {
      return { ...base, state: 'model-missing', available: have.slice(0, 20),
        detail: `The server is answering but does not hold ${link.model}.` };
    }
    return { ...base, state: 'ready', available: have.slice(0, 20) };
  } catch (e) {
    return { ...base, state: 'unreachable',
      detail: (e as Error).name === 'AbortError'
        ? 'The model server did not answer within six seconds — the machine is probably asleep.'
        : 'The model server could not be reached.' };
  }
}

async function probeOpenAI(link: LlmLink): Promise<LinkStatus> {
  const base = { id: link.id, label: link.label, model: link.model, isLocal: link.isLocal };
  try {
    const res = await withTimeout(HEALTH_TIMEOUT, (signal) =>
      fetch(`${link.baseUrl}/models`, { headers: link.headers, signal, cache: 'no-store' }));
    if (res.status === 401 || res.status === 403) {
      return { ...base, state: 'refused', detail: 'The API key was refused.' };
    }
    // A provider that does not implement /models is not a provider that cannot
    // answer: it is reported ready and the first real call decides.
    return { ...base, state: 'ready' };
  } catch {
    return { ...base, state: 'unreachable', detail: 'The provider could not be reached.' };
  }
}

/** The state of every link, in chain order. */
export async function llmStatus(): Promise<LlmStatus> {
  const checkedAt = new Date().toISOString();
  const chain = llmChain();
  if (!chain.length) {
    return { configured: false, online: false, links: [], defaultLink: null, checkedAt,
      reason: 'No model is configured for this deployment.' };
  }
  const links = await Promise.all(chain.map((l) =>
    l.kind === 'ollama' ? probeOllama(l) : probeOpenAI(l)));
  const ready = links.find((l) => l.state === 'ready');
  return {
    configured: true, online: !!ready, links, defaultLink: ready?.id ?? null, checkedAt,
    reason: ready ? undefined
      : links[0]?.detail ?? 'No link in the model chain is answering.',
  };
}

export interface ChainOptions {
  /** Force one link by id. Absent means: walk the chain from the top. */
  only?: string;
  temperature?: number;
  numCtx?: number;
  signal?: AbortSignal;
}

export type ChainEvent =
  | { type: 'link'; link: LlmLink }                       // this one is being tried
  | { type: 'delta'; text: string }
  | { type: 'fallback'; from: LlmLink; reason: string }    // moving down the chain
  | { type: 'done'; link: LlmLink; ms: number }
  | { type: 'failed'; reason: string };                    // nothing answered

/** One link's stream, as text deltas. Throws before the first token if it cannot start. */
async function* streamOne(link: LlmLink, messages: LlmMessage[], opts: ChainOptions)
    : AsyncGenerator<string> {
  const url = link.kind === 'ollama' ? `${link.baseUrl}/api/chat`
                                     : `${link.baseUrl}/chat/completions`;
  const body = link.kind === 'ollama'
    ? { model: link.model, messages, stream: true,
        options: { temperature: opts.temperature ?? 0.2, num_ctx: opts.numCtx ?? 8192 } }
    : { model: link.model, messages, stream: true, temperature: opts.temperature ?? 0.2 };

  const res = await withTimeout(link.timeoutMs, (signal) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...link.headers },
      body: JSON.stringify(body),
      signal: opts.signal ?? signal,
      cache: 'no-store',
    }));
  if (!res.ok || !res.body) throw new Error(`answered ${res.status}`);

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
      if (link.kind === 'ollama') {
        try {
          const o = JSON.parse(line) as { message?: { content?: string } };
          if (o.message?.content) yield o.message.content;
        } catch { /* a partial line at a chunk boundary is completed by the next read */ }
      } else {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const o = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const t = o.choices?.[0]?.delta?.content;
          if (t) yield t;
        } catch { /* likewise */ }
      }
    }
  }
}

/**
 * Walk the chain until one link answers.
 *
 * A link is skipped when the server does not hold its model (checked, never
 * pulled) and abandoned when it cannot start. Once it has produced a single
 * token it owns the answer: see rule 2 above.
 */
export async function* llmChainStream(messages: LlmMessage[], opts: ChainOptions = {})
    : AsyncGenerator<ChainEvent> {
  const chain = llmChain().filter((l) => !opts.only || l.id === opts.only);
  if (!chain.length) {
    yield { type: 'failed', reason: 'No model is configured for this deployment.' };
    return;
  }
  const status = await llmStatus();
  const stateOf = new Map(status.links.map((l) => [l.id, l]));

  for (const link of chain) {
    const st = stateOf.get(link.id);
    if (st && st.state !== 'ready') {
      yield { type: 'fallback', from: link,
        reason: st.detail ?? `${link.label} is not available.` };
      continue;
    }
    yield { type: 'link', link };
    const started = Date.now();
    let emitted = false;
    try {
      for await (const text of streamOne(link, messages, opts)) {
        emitted = true;
        yield { type: 'delta', text };
      }
      yield { type: 'done', link, ms: Date.now() - started };
      return;
    } catch (e) {
      const why = (e as Error).name === 'AbortError'
        ? `${link.label} did not finish within ${Math.round(link.timeoutMs / 1000)}s`
        : `${link.label} ${(e as Error).message}`;
      if (emitted) {
        // Rule 2: the reader is already reading this answer.
        yield { type: 'failed', reason: `${why}. The answer above is incomplete — `
          + 'it stopped part-way rather than being rewritten by another model.' };
        return;
      }
      yield { type: 'fallback', from: link, reason: why };
    }
  }
  yield { type: 'failed', reason: 'No link in the model chain could answer.' };
}

/** The whole completion from the first link that answers, for non-streaming callers. */
export async function llmChat(messages: LlmMessage[], opts: ChainOptions = {})
    : Promise<{ text: string; link: LlmLink | null; fellBack: string[] }> {
  let text = '';
  let link: LlmLink | null = null;
  const fellBack: string[] = [];
  for await (const ev of llmChainStream(messages, opts)) {
    if (ev.type === 'link') link = ev.link;
    if (ev.type === 'delta') text += ev.text;
    if (ev.type === 'fallback') fellBack.push(ev.reason);
    if (ev.type === 'failed' && !text) throw new Error(ev.reason);
  }
  return { text, link, fellBack };
}
