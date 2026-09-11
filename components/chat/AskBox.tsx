'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

/**
 * Ask the local models, with this site's sources attached.
 *
 * The models run on a Mac Studio behind a tunnel, so three states are real and
 * all three are shown plainly: checking, answering, and offline-because-the-
 * machine-is-asleep. Offline is not an error state here — it is Tuesday — so it
 * reads as a note rather than a failure, and it says what still works.
 *
 * Nothing is stored. No transcript in localStorage, no history on the server:
 * the conversation lives in this component's state and ends with the tab. The
 * footer's claim that no controlled unclassified information transits this site
 * is only worth making if nothing here quietly keeps a copy.
 */

interface Source { kind: string; title: string; detail: string; href?: string; source?: string }
interface LinkState {
  id: string; label: string; model: string; isLocal: boolean;
  state: 'ready' | 'unreachable' | 'model-missing' | 'refused' | 'unconfigured';
  detail?: string; available?: string[];
}
interface Msg {
  role: 'user' | 'assistant'; content: string; sources?: Source[]; ms?: number;
  answeredBy?: { label: string; isLocal: boolean };
  fellBack?: { label: string; reason: string }[];
}
interface Status {
  configured: boolean; online: boolean; defaultLink: string | null;
  reason?: string; links: LinkState[];
}

const SUGGESTED = [
  'What has to be in an R-2 Program Change Summary, and what must never be?',
  'How current is the execution warehouse, and what is the newest period that exists?',
  'Why is a direct-plus-reimbursable obligation total double counting?',
  'Which justification books does this site hold for O&M, and how far back?',
];

const KIND_LABEL: Record<string, string> = {
  wiki: 'Knowledge bank', definition: 'Definition', book: 'Justification book', dataset: 'Provenance',
};

export default function AskBox() {
  const [status, setStatus] = useState<Status | null>(null);
  // '' means walk the chain from the top, which is the normal way to ask.
  const [link, setLink] = useState<string>('');
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const tail = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/chat')
      .then((r) => r.json())
      .then((s: Status) => { if (live) setStatus(s); })
      .catch(() => { if (live) setStatus({ configured: false, online: false, defaultLink: null,
        links: [], reason: 'The site could not check the model chain.' }); });
    return () => { live = false; };
  }, []);

  useEffect(() => { tail.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); },
    [msgs, busy]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setError(null);
    setInput('');
    const history = [...msgs, { role: 'user' as const, content: question }];
    setMsgs([...history, { role: 'assistant', content: '' }]);
    setBusy(true);
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          link: link || undefined }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ error: `The chat endpoint answered ${res.status}.` }));
        setMsgs((m) => m.slice(0, -1));
        setError(j.error ?? 'The chat could not answer.');
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const ev = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (!ev || !data) continue;
          const payload = JSON.parse(data);
          setMsgs((prev) => {
            const next = [...prev];
            const last = { ...next[next.length - 1] };
            if (ev === 'sources') last.sources = payload.sources;
            if (ev === 'link') last.answeredBy = { label: payload.label, isLocal: payload.isLocal };
            if (ev === 'fallback') {
              last.fellBack = [...(last.fellBack ?? []),
                { label: payload.label, reason: payload.reason }];
            }
            if (ev === 'delta') last.content += payload.t;
            if (ev === 'done') {
              last.ms = payload.ms;
              last.answeredBy = { label: payload.label, isLocal: payload.isLocal };
            }
            if (ev === 'error') { setError(payload.error); }
            next[next.length - 1] = last;
            return next;
          });
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setMsgs((m) => (m[m.length - 1]?.content ? m : m.slice(0, -1)));
        setError('The connection to the chat dropped.');
      }
    } finally {
      setBusy(false);
    }
  }

  const offline = status && (!status.configured || !status.online);

  return (
    <div className="glass-card rounded-xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
        <h2 className="text-lg font-bold text-navy-50">Ask the corpus</h2>
        <StatusPill status={status} />
        {status && status.links.length > 1 && (
          <label className="ml-auto flex items-center gap-2 text-[12px] text-navy-500">
            Model
            <select value={link} onChange={(e) => setLink(e.target.value)}
              className="bg-navy-900 border border-navy-700 rounded px-2 py-1 text-[12px] text-navy-200">
              <option value="">the chain, in order</option>
              {status.links.map((l) => (
                <option key={l.id} value={l.id} disabled={l.state !== 'ready'}>
                  {l.label}{l.isLocal ? ' · local' : ' · commercial'}
                  {l.state === 'ready' ? '' : ` (${l.state.replace('-', ' ')})`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <p className="text-sm text-navy-400 leading-relaxed mb-4 max-w-3xl">
        The first two models run locally on a Mac Studio and have been trained on the justification
        books and the DoD financial-management knowledge bank; a commercial model sits behind them
        and answers only when neither is reachable. Every answer is retrieved against this
        site&rsquo;s own corpus first and lists the sources it used — because a model that has read
        every book will write a confident figure for one it has not — and every answer names the
        model that produced it.
      </p>

      {status && status.links.length > 0 && <ChainStrip links={status.links} />}

      {msgs.length > 0 && (
        <div className="space-y-5 mb-5 max-h-[32rem] overflow-y-auto pr-1">
          {msgs.map((m, i) => (
            <div key={i}>
              {m.role === 'user' ? (
                <p className="text-sm text-navy-100 font-medium">
                  <span className="text-accent-400 mr-2">You</span>{m.content}
                </p>
              ) : (
                <div>
                  {m.sources && m.sources.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {m.sources.map((s, j) => (
                        <SourceChip key={j} s={s} />
                      ))}
                    </div>
                  )}
                  {m.fellBack?.map((f, k) => (
                    <p key={k} className="text-[12px] text-amber-300 mb-1.5">
                      {f.reason} — moved down the chain.
                    </p>
                  ))}
                  <Answer text={m.content} pending={busy && i === msgs.length - 1} />
                  {m.answeredBy && (
                    <p className="text-[12px] text-navy-500 mt-2">
                      answered by{' '}
                      <span className={m.answeredBy.isLocal ? 'text-accent-400' : 'text-amber-300'}>
                        {m.answeredBy.label}
                      </span>
                      {m.answeredBy.isLocal ? ' on the local machine' : ' — a commercial model, not the tuned local one'}
                      {m.ms != null ? ` · ${(m.ms / 1000).toFixed(1)}s` : ''} · the sources above are
                      what the site retrieved, not what the model recalled
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={tail} />
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!!offline}
          placeholder={offline
            ? 'No model in the chain is answering right now'
            : 'Ask about the budget, execution, a control, or a justification book…'}
          className="flex-1 bg-navy-900 border border-navy-700 focus:border-accent-500 outline-none
                     rounded-lg px-4 py-2.5 text-sm text-navy-100 placeholder:text-navy-500
                     disabled:opacity-60"
        />
        <button type="submit" disabled={!!offline || busy || !input.trim()}
          className="px-4 py-2.5 rounded-lg bg-accent-500 hover:bg-accent-600 disabled:opacity-40
                     disabled:hover:bg-accent-500 text-navy-950 font-semibold text-sm transition-colors">
          {busy ? 'Answering…' : 'Ask'}
        </button>
      </form>

      {error && (
        <p className="mt-3 text-[13px] text-[color:var(--status-critical)]">{error}</p>
      )}

      {msgs.length === 0 && !offline && (
        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTED.map((s) => (
            <button key={s} onClick={() => ask(s)}
              className="text-left text-[12px] text-navy-300 border border-navy-800 hover:border-accent-500/50
                         rounded-full px-3 py-1.5 transition-colors">
              {s}
            </button>
          ))}
        </div>
      )}

      {offline && status && (
        <div className="mt-4 text-[13px] text-navy-400 leading-relaxed">
          <p>{status.reason ?? 'No model in the chain is answering.'}</p>
          {status.links.filter((l) => l.detail).map((l) => (
            <p key={l.id} className="mt-1">
              <span className="text-navy-200">{l.label}</span> — {l.detail}
              {l.state === 'model-missing' && l.available?.length
                ? ` The server holds: ${l.available.slice(0, 6).join(', ')}.` : ''}
            </p>
          ))}
          <p className="mt-1.5">
            Nothing else depends on it:{' '}
            <Link href="/regulation" className="text-accent-400 hover:underline">regulatory search</Link>{' '}
            is the retrieval half of this feature and runs in the browser, and{' '}
            <Link href="/jbook" className="text-accent-400 hover:underline">the justification books</Link>{' '}
            are read from the database.
          </p>
        </div>
      )}

      <p className="mt-4 text-[12px] text-navy-500 leading-relaxed">
        Nothing you type is stored: no transcript is kept on the server and none is written to this
        browser. Do not paste controlled unclassified information — this site holds none and none
        should transit it.
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: Status | null }) {
  if (!status) {
    return <span className="text-[12px] text-navy-500">checking the model chain…</span>;
  }
  const ready = status.links.find((l) => l.state === 'ready');
  const label = !status.configured ? 'no model configured'
    : !ready ? 'model chain offline'
    : ready.isLocal ? `local model online · ${ready.label}`
    : `commercial fallback only · ${ready.label}`;
  return (
    <span className={`text-[12px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border
      ${!ready ? 'text-navy-400 border-navy-700'
        : ready.isLocal ? 'text-accent-400 border-accent-500/50'
        : 'text-amber-300 border-amber-400/50'}`}>
      {label}
    </span>
  );
}

/**
 * The chain, shown as it is: three links in order, each with its real state.
 * A local model that is down is a fact about the machine, not an error to hide —
 * and seeing WHY (asleep, tag not held, secret refused) is what makes it fixable.
 */
function ChainStrip({ links }: { links: LinkState[] }) {
  const STATE: Record<string, string> = {
    ready: 'answering', unreachable: 'not reachable', 'model-missing': 'not loaded on the server',
    refused: 'credentials refused', unconfigured: 'not configured',
  };
  const first = links.findIndex((l) => l.state === 'ready');
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-4">
      {links.map((l, i) => (
        <span key={l.id} className="flex items-center gap-2">
          {i > 0 && <span className="text-navy-600 text-[12px]">→</span>}
          <span className={`text-[12px] px-2 py-1 rounded border ${
            i === first ? 'border-accent-500/50 text-accent-300'
              : l.state === 'ready' ? 'border-navy-700 text-navy-300'
              : 'border-navy-800 text-navy-500'}`}
            title={l.detail ?? (l.state === 'ready' ? 'ready' : '')}>
            {l.label}
            <span className="text-navy-500 ml-1.5">
              {l.isLocal ? 'local' : 'commercial'} · {STATE[l.state] ?? l.state}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

function SourceChip({ s }: { s: Source }) {
  const inner = (
    <>
      <span className="text-accent-400">{KIND_LABEL[s.kind] ?? s.kind}</span>
      <span className="text-navy-200 ml-1.5">{s.title}</span>
      {s.source && <span className="text-navy-500 ml-1.5">· {s.source}</span>}
    </>
  );
  return s.href
    ? <Link href={s.href} className="text-[12px] border border-navy-800 hover:border-accent-500/50
         rounded px-2 py-1 transition-colors" title={s.detail}>{inner}</Link>
    : <span className="text-[12px] border border-navy-800 rounded px-2 py-1" title={s.detail}>{inner}</span>;
}

/** Paragraphs and bullets, deliberately not a markdown renderer. */
function Answer({ text, pending }: { text: string; pending: boolean }) {
  if (!text) {
    return <p className="text-sm text-navy-500">{pending ? 'thinking…' : ''}</p>;
  }
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        const isList = lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        if (isList) {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1">
              {lines.map((l, j) => (
                <li key={j} className="text-sm text-navy-300 leading-relaxed">
                  {l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')}
                </li>
              ))}
            </ul>
          );
        }
        return <p key={i} className="text-sm text-navy-300 leading-relaxed">{b}</p>;
      })}
      {pending && <span className="inline-block w-2 h-4 bg-accent-500/70 animate-pulse align-text-bottom" />}
    </div>
  );
}
