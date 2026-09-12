'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

/**
 * Ask the corpus.
 *
 * The first cut was a box wedged between the hero and the stat tiles: a single
 * input line, answers growing inline, and every other section of the landing
 * page shifting down as text arrived. This is a room of its own — a bordered
 * panel with a header that says what the chain is and what it can draw on, a
 * transcript area of fixed height that scrolls itself, and a composer at the
 * bottom. Nothing outside the panel moves while an answer streams.
 *
 * Three states are real and all three are shown plainly: checking, answering,
 * and offline-because-the-machine-is-asleep. Offline is not an error here — it
 * is Tuesday — so it reads as a note rather than a failure, and it says what
 * still works.
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
  retrieved?: Record<string, number>;
}
interface Status {
  configured: boolean; online: boolean; defaultLink: string | null;
  reason?: string; links: LinkState[];
  corpus?: Record<string, number>;
}

const SUGGESTED = [
  'What must an R-2 Program Change Summary carry, and what must never appear in one?',
  'How is a Description of Operations Financed written in an OP-5?',
  'What were the Department’s obligations last year, and how much of that was reimbursable?',
  'Which validation controls are failing right now, and what do they mean?',
];

const KIND_LABEL: Record<string, string> = {
  wiki: 'Knowledge bank', definition: 'Definition', book: 'Justification book',
  passage: 'Book passage', figure: 'Figure', program: 'Programme', control: 'Control',
  dataset: 'Provenance',
};
const KIND_ORDER = ['passage', 'figure', 'book', 'program', 'control', 'definition', 'wiki', 'dataset'];
const RETRIEVED_LABEL: Record<string, string> = {
  passages: 'book passages', sections: 'section profiles', books: 'books', figures: 'fiscal years',
  programs: 'programme lines', controls: 'control findings', definitions: 'defined terms',
  wiki: 'knowledge-bank passages',
};

export default function AskBox({ variant = 'panel' }: { variant?: 'panel' | 'page' }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState<string>('');
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const tail = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/chat')
      .then((r) => r.json())
      .then((s: Status) => { if (live) setStatus(s); })
      .catch(() => { if (live) setStatus({ configured: false, online: false, defaultLink: null,
        links: [], reason: 'The site could not check the model chain.' }); });
    return () => { live = false; };
  }, []);

  // Only the transcript scrolls. Scrolling the page under a streaming answer is
  // what made the first version unusable while anything else was on screen.
  useEffect(() => {
    tail.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [msgs, busy]);

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
            if (ev === 'sources') { last.sources = payload.sources; last.retrieved = payload.retrieved; }
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
            if (ev === 'error') setError(payload.error);
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

  const offline = !!status && (!status.configured || !status.online);
  const transcriptHeight = variant === 'page'
    ? 'h-[calc(100vh-22rem)] min-h-[24rem]' : 'h-[28rem]';

  return (
    <div className="rounded-xl border border-navy-800 bg-navy-900/40 overflow-hidden">
      {/* ------------------------------------------------------------ header */}
      <div className="px-5 sm:px-6 py-4 border-b border-navy-800 bg-navy-900/60">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="text-lg font-bold text-navy-50">Ask the corpus</h2>
          <StatusPill status={status} />
          {msgs.length > 0 && (
            <button onClick={() => { setMsgs([]); setError(null); }}
              className="text-[12px] text-navy-400 hover:text-accent-400 transition-colors">
              clear
            </button>
          )}
          {status && status.links.length > 1 && (
            <label className="ml-auto flex items-center gap-2 text-[12px] text-navy-500">
              Model
              <select value={link} onChange={(e) => setLink(e.target.value)}
                className="bg-navy-800 border border-navy-700 rounded px-2 py-1 text-[12px] text-navy-200">
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

        {status && status.links.length > 0 && <ChainStrip links={status.links} />}
        {status?.corpus && <CorpusStrip corpus={status.corpus} />}

        {status?.links.some((l) => l.isLocal && l.state !== 'ready' && l.detail) && (
          <p className="mt-2 text-[12px] text-amber-300 leading-relaxed">
            {status.links.filter((l) => l.isLocal && l.state !== 'ready' && l.detail)[0]!.label}
            {' — '}
            {status.links.filter((l) => l.isLocal && l.state !== 'ready' && l.detail)[0]!.detail}
          </p>
        )}
      </div>

      {/* -------------------------------------------------------- transcript */}
      <div className={`${transcriptHeight} overflow-y-auto px-5 sm:px-6 py-5 bg-navy-950/50`}>
        {msgs.length === 0 ? (
          <EmptyState offline={offline} status={status} onPick={ask} />
        ) : (
          <div className="space-y-7 max-w-3xl">
            {msgs.map((m, i) => (
              <div key={i}>
                {m.role === 'user' ? (
                  <div className="flex gap-3">
                    <span className="text-[12px] font-semibold uppercase tracking-wider text-accent-400 pt-0.5 shrink-0">
                      You
                    </span>
                    <p className="text-sm text-navy-100 font-medium leading-relaxed">{m.content}</p>
                  </div>
                ) : (
                  <div className="pl-0 sm:pl-12">
                    {m.sources && m.sources.length > 0 && (
                      <Sources sources={m.sources} retrieved={m.retrieved} />
                    )}
                    {m.fellBack?.map((f, k) => (
                      <p key={k} className="text-[12px] text-amber-300 mb-2">
                        {f.reason} — moved down the chain.
                      </p>
                    ))}
                    <Answer text={m.content} pending={busy && i === msgs.length - 1} />
                    {m.answeredBy && (
                      <p className="text-[12px] text-navy-500 mt-3 leading-relaxed">
                        answered by{' '}
                        <span className={m.answeredBy.isLocal ? 'text-accent-400' : 'text-amber-300'}>
                          {m.answeredBy.label}
                        </span>
                        {m.answeredBy.isLocal
                          ? ' on the local machine'
                          : ' — a commercial model, not the tuned local one'}
                        {m.ms != null ? ` · ${(m.ms / 1000).toFixed(1)}s` : ''}
                        {' · the sources above are what the site retrieved, not what the model recalled'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={tail} />
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------- composer */}
      <div className="border-t border-navy-800 bg-navy-900/60 px-5 sm:px-6 py-4">
        <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="flex gap-3 items-end">
          <textarea
            ref={box}
            value={input}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, shift+Enter is a newline — the convention every
              // chat uses, and the reason the single-line input felt wrong for
              // questions that run to three clauses.
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); }
            }}
            disabled={offline}
            placeholder={offline
              ? 'No model in the chain is answering right now'
              : 'Ask about a justification book, a figure, a control, or how something is written…'}
            className="flex-1 resize-none bg-navy-800 border border-navy-700 focus:border-accent-500
                       outline-none rounded-lg px-4 py-3 text-sm text-navy-100
                       placeholder:text-navy-500 disabled:opacity-60 leading-relaxed"
          />
          <button type="submit" disabled={offline || busy || !input.trim()}
            className="px-5 py-3 rounded-lg bg-accent-500 hover:bg-accent-600 disabled:opacity-40
                       disabled:hover:bg-accent-500 text-navy-950 font-semibold text-sm
                       transition-colors shrink-0">
            {busy ? 'Answering…' : 'Ask'}
          </button>
        </form>
        {error && <p className="mt-2.5 text-[13px] text-[color:var(--status-critical)]">{error}</p>}
        <p className="mt-2.5 text-[12px] text-navy-500 leading-relaxed">
          Nothing you type is stored: no transcript on the server, none in this browser. Do not paste
          controlled unclassified information — this site holds none and none should transit it.
          {variant === 'panel' && (
            <> · <Link href="/ask" className="text-accent-400 hover:underline">open the full page</Link></>
          )}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ parts -- */

function StatusPill({ status }: { status: Status | null }) {
  if (!status) return <span className="text-[12px] text-navy-500">checking the model chain…</span>;
  const ready = status.links.find((l) => l.state === 'ready');
  const label = !status.configured ? 'no model configured'
    : !ready ? 'model chain offline'
    : ready.isLocal ? `local model online · ${ready.label}`
    : `commercial fallback only · ${ready.label}`;
  return (
    <span className={`text-[12px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full border
      ${!ready ? 'text-navy-400 border-navy-700'
        : ready.isLocal ? 'text-accent-400 border-accent-500/50'
        : 'text-amber-300 border-amber-400/50'}`}>
      {label}
    </span>
  );
}

/** The chain, shown as it is: each link in order with its real state. */
function ChainStrip({ links }: { links: LinkState[] }) {
  const STATE: Record<string, string> = {
    ready: 'answering', unreachable: 'not reachable', 'model-missing': 'not offered by the server',
    refused: 'key rejected', unconfigured: 'no key set',
  };
  const first = links.findIndex((l) => l.state === 'ready');
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mt-3">
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

/**
 * What retrieval can draw on, counted.
 *
 * This exists because the honest answer to "why doesn't it know the J-books"
 * should be visible rather than guessed at. Zero books here means the corpus is
 * not loaded on this deployment, and the page says so instead of letting the
 * model look ignorant.
 */
function CorpusStrip({ corpus }: { corpus: Record<string, number> }) {
  const items: [string, string][] = [
    ['books', 'justification books'], ['passages', 'passages searchable'],
    ['fiscalYears', 'fiscal years of measures'], ['definitions', 'defined terms'],
    ['wiki', 'knowledge-bank passages'],
  ];
  const have = items.filter(([k]) => (corpus[k] ?? 0) > 0);
  if (!have.length) {
    return (
      <p className="mt-2 text-[12px] text-amber-300">
        The corpus is not loaded on this deployment, so answers carry no retrieved sources.
      </p>
    );
  }
  return (
    <p className="mt-2 text-[12px] text-navy-500">
      retrieving from{' '}
      {have.map(([k, label], i) => (
        <span key={k}>
          {i > 0 ? ' · ' : ''}
          <span className="text-navy-300">{corpus[k].toLocaleString()}</span> {label}
        </span>
      ))}
    </p>
  );
}

function Sources({ sources, retrieved }: { sources: Source[]; retrieved?: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  // The ANSWER is the point and the citations support it. The first cut printed
  // twenty-one chips above every answer and pushed the prose off the bottom of
  // the panel — which inverts that, and makes a well-sourced answer look like a
  // search results page. So: one line saying what was retrieved, the three most
  // specific sources, and the rest one click away.
  const ordered = [...sources].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const counts = Object.entries(retrieved ?? {}).filter(([, n]) => n > 0);
  const shown = open ? ordered : ordered.slice(0, 3);
  return (
    <div className="mb-3.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        {counts.length > 0 && (
          <p className="text-[12px] text-navy-500">
            retrieved{' '}
            {counts.map(([k, n], i) => (
              <span key={k}>
                {i > 0 ? ', ' : ''}
                <span className="text-navy-300">{n}</span> {RETRIEVED_LABEL[k] ?? k}
              </span>
            ))}
          </p>
        )}
        {ordered.length > 3 && (
          <button onClick={() => setOpen((o) => !o)}
            className="text-[12px] text-accent-400 hover:underline">
            {open ? 'hide sources' : `all ${ordered.length} sources`}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((s, j) => {
          const inner = (
            <>
              <span className="text-accent-400 shrink-0">{KIND_LABEL[s.kind] ?? s.kind}</span>
              <span className="text-navy-200 ml-1.5 truncate">{s.title}</span>
            </>
          );
          const cls = 'text-[12px] border border-navy-800 rounded px-2 py-1 max-w-full '
            + 'sm:max-w-[22rem] flex items-baseline overflow-hidden';
          const title = `${s.detail}${s.source ? ` — ${s.source}` : ''}`;
          return s.href
            ? <Link key={j} href={s.href} title={title}
                className={`${cls} hover:border-accent-500/50 transition-colors`}>{inner}</Link>
            : <span key={j} title={title} className={cls}>{inner}</span>;
        })}
      </div>
    </div>
  );
}

function EmptyState({ offline, status, onPick }: {
  offline: boolean; status: Status | null; onPick: (q: string) => void;
}) {
  return (
    <div className="max-w-3xl">
      <p className="text-sm text-navy-400 leading-relaxed">
        The first two models run locally on a Mac Studio and have been trained on the justification
        books and the DoD financial-management knowledge bank; a commercial model sits behind them
        and answers only when neither is reachable. Every question is retrieved against this
        site&rsquo;s own corpus first — the books&rsquo; own text, the measures, the controls — and
        every answer lists what it used and names the model that wrote it.
      </p>

      {offline && status ? (
        <div className="mt-5 text-[13px] text-navy-400 leading-relaxed">
          <p className="text-navy-200">{status.reason ?? 'No model in the chain is answering.'}</p>
          {status.links.filter((l) => l.detail).map((l) => (
            <p key={l.id} className="mt-1.5">
              <span className="text-navy-200">{l.label}</span> — {l.detail}
              {l.state === 'model-missing' && l.available?.length
                ? ` The server offers: ${l.available.slice(0, 6).join(', ')}.` : ''}
            </p>
          ))}
          <p className="mt-3">
            Nothing else depends on it:{' '}
            <Link href="/regulation" className="text-accent-400 hover:underline">regulatory search</Link>{' '}
            is the retrieval half of this feature and runs in the browser, and{' '}
            <Link href="/jbook" className="text-accent-400 hover:underline">the justification books</Link>{' '}
            are read from the database.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {SUGGESTED.map((s) => (
            <button key={s} onClick={() => onPick(s)}
              className="text-left text-[13px] text-navy-300 border border-navy-800 rounded-lg
                         px-4 py-3 hover:border-accent-500/50 hover:text-navy-100 transition-colors
                         leading-relaxed">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Paragraphs, bullets and headings — deliberately not a markdown renderer. */
function Answer({ text, pending }: { text: string; pending: boolean }) {
  if (!text) {
    return (
      <p className="text-sm text-navy-500">
        {pending ? 'retrieving from the corpus, then thinking…' : ''}
      </p>
    );
  }
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        const isList = lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        if (isList) {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1.5">
              {lines.map((l, j) => (
                <li key={j} className="text-sm text-navy-300 leading-relaxed">
                  {l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')}
                </li>
              ))}
            </ul>
          );
        }
        if (/^#{1,4}\s+/.test(b)) {
          return (
            <h4 key={i} className="text-sm font-semibold text-navy-100 pt-1">
              {b.replace(/^#{1,4}\s+/, '')}
            </h4>
          );
        }
        return <p key={i} className="text-sm text-navy-300 leading-relaxed">{b}</p>;
      })}
      {pending && (
        <span className="inline-block w-2 h-4 bg-accent-500/70 animate-pulse align-text-bottom" />
      )}
    </div>
  );
}
