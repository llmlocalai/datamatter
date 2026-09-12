'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * The working surface of a case: the action runner, the copilot, and the
 * workflow.
 *
 * Three things here are deliberate rather than incidental.
 *
 * The token is held in component state and never in localStorage. It is a
 * shared secret that moves a remediation case, and a secret in a browser's
 * storage outlives the session, the tab and the person.
 *
 * A model action always renders behind a "proposal" label with the link that
 * produced it, and recording it to the timeline is a separate press. The point
 * of the separation is that a drafted root cause on a case record is a claim
 * about why the Department's books are wrong, and a person has to make it.
 *
 * Offline is a normal state. Every deterministic action keeps working with the
 * model chain down, and the panel says which link is unreachable rather than
 * presenting an outage as a broken page.
 */

interface Action { code: string; label: string; kind: 'deterministic' | 'model';
  description: string; humanStep: string }

export default function CaseConsole({ caseKey, states, currentState }: {
  caseKey: string; states: readonly string[]; currentState: string;
}) {
  const [actions, setActions] = useState<Action[]>([]);
  const [writable, setWritable] = useState(false);
  const [model, setModel] = useState<{ online: boolean; reason?: string;
    links: { label: string; state: string; detail?: string }[] } | null>(null);
  const [token, setToken] = useState('');
  const [actor, setActor] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ code: string; summary: string; payload: string;
    modelLink?: string | null; kind: string; reviewRequired: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [answerLink, setAnswerLink] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [showFacts, setShowFacts] = useState(false);
  const [facts, setFacts] = useState('');
  const abort = useRef<AbortController | null>(null);

  const [state, setState] = useState(currentState);
  const [ownerOrg, setOwnerOrg] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    fetch('/api/sbr?action=actions').then((r) => r.json()).then((d) => {
      setActions(d.actions ?? []);
      setWritable(!!d.writable);
      setModel(d.model ?? null);
    }).catch(() => setModel(null));
  }, []);

  const headers = () => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['x-sbr-token'] = token;
    return h;
  };

  async function run(code: string, record: boolean) {
    setBusy(code); setError(null); setNotice(null); setResult(null);
    try {
      const r = await fetch('/api/sbr', { method: 'POST', headers: headers(),
        body: JSON.stringify({ action: 'run', case: caseKey, code, record, actor }) });
      const d = await r.json();
      if (!r.ok || d.ok === false) { setError(d.error ?? 'The action did not complete.'); return; }
      setResult(d);
      if (record) setNotice('Recorded on the case timeline. Reload to see it in the record.');
    } catch (e: any) {
      setError(e?.message ?? 'The action did not complete.');
    } finally { setBusy(null); }
  }

  async function ask() {
    if (!question.trim() || streaming) return;
    setStreaming(true); setAnswer(''); setAnswerLink(null); setError(null);
    abort.current?.abort();
    abort.current = new AbortController();
    try {
      const r = await fetch('/api/sbr/copilot', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, signal: abort.current.signal,
        body: JSON.stringify({ case: caseKey, question }) });
      if (!r.ok || !r.body) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? 'The copilot is unavailable.'); setStreaming(false); return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const p of parts) {
          const ev = /^event: (.+)$/m.exec(p)?.[1];
          const raw = /^data: (.+)$/m.exec(p)?.[1];
          if (!ev || !raw) continue;
          const d = JSON.parse(raw);
          if (ev === 'context') setFacts(d.facts ?? '');
          else if (ev === 'link') setAnswerLink(d.label);
          else if (ev === 'delta') setAnswer((a) => a + d.text);
          else if (ev === 'fallback') setNotice(`Fell back from ${d.from}: ${d.reason}`);
          else if (ev === 'failed') setError(d.reason);
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e?.message ?? 'The stream ended.');
    } finally { setStreaming(false); }
  }

  async function move() {
    setBusy('state'); setError(null); setNotice(null);
    try {
      const r = await fetch('/api/sbr', { method: 'POST', headers: headers(),
        body: JSON.stringify({ action: 'state', case: caseKey, state, actor,
          ownerOrg: ownerOrg || undefined, rootCause: rootCause || undefined,
          correctiveAction: correctiveAction || undefined,
          dueDate: dueDate || undefined, note: note || undefined }) });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? 'The case did not move.'); return; }
      setNotice(`Case set to ${state}. Reload to see the updated record.`);
    } catch (e: any) { setError(e?.message ?? 'The case did not move.'); }
    finally { setBusy(null); }
  }

  const det = actions.filter((a) => a.kind === 'deterministic');
  const mod = actions.filter((a) => a.kind === 'model');
  const input = 'w-full rounded border border-navy-700 bg-navy-950/60 px-2.5 py-1.5 '
    + 'text-sm text-navy-100 placeholder:text-navy-600 focus:border-accent-500/50 focus:outline-none';
  const btn = 'rounded border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40';

  return (
    <div className="space-y-8">
      {/* ---------------------------------------------------------- credentials */}
      <div className="glass-card rounded-lg p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[12px] uppercase tracking-wider text-navy-400 font-semibold">
              Your name or office
            </span>
            <input className={`${input} mt-1.5`} value={actor} placeholder="recorded on every entry"
              onChange={(e) => setActor(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-[12px] uppercase tracking-wider text-navy-400 font-semibold">
              Remediation token
            </span>
            <input className={`${input} mt-1.5`} type="password" value={token}
              placeholder={writable ? 'required to write to this case' : 'writing is closed on this deployment'}
              onChange={(e) => setToken(e.target.value)} disabled={!writable} />
          </label>
        </div>
        <p className="text-xs text-navy-500 mt-3 leading-relaxed">
          The token is held in this tab only and never stored. Everything that reads the extract
          works without it; everything that writes to the case record does not.
          {model && !model.online && (
            <> The model chain is not answering{model.reason ? `: ${model.reason}` : ''}. The
            deterministic actions below do not need it.</>
          )}
          {model && model.online && (
            <> Model chain online: {model.links.filter((l) => l.state === 'ready')
              .map((l) => l.label).join(', ') || 'no link ready'}.</>
          )}
        </p>
      </div>

      {error && (
        <p className="text-sm text-[color:var(--status-critical)] border-l-2 border-[color:var(--status-critical)] pl-3">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-[color:var(--status-warning)] border-l-2 border-[color:var(--status-warning)] pl-3">
          {notice}
        </p>
      )}

      {/* ------------------------------------------------------------- actions */}
      <div>
        <h3 className="text-sm font-semibold text-navy-100 mb-1">Deterministic actions</h3>
        <p className="text-xs text-navy-400 mb-4 max-w-3xl leading-relaxed">
          Built by query over the loaded extract. No model contributes a figure to any of these,
          and they work with the model chain offline.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {det.map((a) => (
            <div key={a.code} className="glass-card rounded-lg p-4 flex flex-col">
              <div className="text-sm font-semibold text-navy-100">{a.label}</div>
              <p className="text-xs text-navy-400 mt-1.5 leading-relaxed flex-1">{a.description}</p>
              <p className="text-[11px] text-navy-600 mt-2 leading-relaxed">{a.humanStep}</p>
              <div className="flex gap-2 mt-3">
                <button className={`${btn} border-navy-700 text-navy-200 hover:border-accent-500/40`}
                  disabled={busy === a.code} onClick={() => run(a.code, false)}>
                  {busy === a.code ? 'running…' : 'Run'}
                </button>
                <button className={`${btn} border-navy-800 text-navy-500 hover:text-navy-200`}
                  disabled={busy === a.code || !writable || !token}
                  title={writable ? 'Run and record on the case timeline' : 'Writing is closed'}
                  onClick={() => run(a.code, true)}>
                  Run and record
                </button>
              </div>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-semibold text-navy-100 mt-8 mb-1">Model-drafted proposals</h3>
        <p className="text-xs text-navy-400 mb-4 max-w-3xl leading-relaxed">
          The local model is given the case facts below and nothing else. It has no database and
          no tools, it does not conclude that a misstatement exists, and what it returns is a
          proposal attributed to the link that produced it. Recording one is a separate, named act
          by a person.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {mod.map((a) => (
            <div key={a.code} className="glass-card rounded-lg p-4 flex flex-col">
              <div className="text-sm font-semibold text-navy-100">{a.label}</div>
              <p className="text-xs text-navy-400 mt-1.5 leading-relaxed flex-1">{a.description}</p>
              <p className="text-[11px] text-navy-600 mt-2 leading-relaxed">{a.humanStep}</p>
              <div className="flex gap-2 mt-3">
                <button className={`${btn} border-navy-700 text-navy-200 hover:border-accent-500/40`}
                  disabled={busy === a.code || !writable || !token || !(model?.online)}
                  title={!(model?.online) ? 'The model chain is not answering' : undefined}
                  onClick={() => run(a.code, false)}>
                  {busy === a.code ? 'drafting…' : 'Draft'}
                </button>
                <button className={`${btn} border-navy-800 text-navy-500 hover:text-navy-200`}
                  disabled={busy === a.code || !writable || !token || !(model?.online)}
                  onClick={() => run(a.code, true)}>
                  Draft and record
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {result && (
        <div className="glass-card rounded-lg p-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-semibold text-navy-100">{result.summary}</span>
            {result.reviewRequired && (
              <span className="rounded border border-[color:var(--status-warning)]/30 bg-[color:var(--status-warning)]/12
                               px-1.5 py-0.5 text-[11px] font-semibold text-[color:var(--status-warning)]">
                proposal · review before use
              </span>
            )}
            {result.modelLink && (
              <span className="text-[11px] text-navy-500">drafted by {result.modelLink}</span>
            )}
          </div>
          <pre className="mt-3 max-h-[30rem] overflow-auto whitespace-pre-wrap break-words
                          rounded border border-navy-800 bg-navy-950/60 p-4 text-[12px]
                          leading-relaxed text-navy-200">{result.payload}</pre>
        </div>
      )}

      {/* ------------------------------------------------------------- copilot */}
      <div>
        <h3 className="text-sm font-semibold text-navy-100 mb-1">Ask about this case</h3>
        <p className="text-xs text-navy-400 mb-3 max-w-3xl leading-relaxed">
          Grounded on the same facts block every action uses. Ask what a finding means, what would
          confirm or refute a cause, or what record would have to be consulted next.
        </p>
        <div className="flex gap-2">
          <input className={input} value={question} placeholder="What would confirm or refute the SBR-X06 finding here?"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ask(); }} />
          <button className={`${btn} border-accent-500/40 bg-accent-500/12 text-accent-400 shrink-0`}
            disabled={streaming || !(model?.online)} onClick={ask}>
            {streaming ? 'thinking…' : 'Ask'}
          </button>
        </div>
        {answer && (
          <div className="mt-4 glass-card rounded-lg p-5">
            {answerLink && (
              <div className="text-[11px] text-navy-500 mb-2">answered by {answerLink}</div>
            )}
            <div className="whitespace-pre-wrap text-sm text-navy-200 leading-relaxed">{answer}</div>
          </div>
        )}
        {facts && (
          <div className="mt-3">
            <button className="text-xs text-navy-500 hover:text-accent-400"
              onClick={() => setShowFacts((s) => !s)}>
              {showFacts ? 'Hide' : 'Show'} the exact facts the model was given
            </button>
            {showFacts && (
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded border
                              border-navy-800 bg-navy-950/60 p-4 text-[11px] text-navy-400">{facts}</pre>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ workflow */}
      <div>
        <h3 className="text-sm font-semibold text-navy-100 mb-1">Move the case</h3>
        <p className="text-xs text-navy-400 mb-4 max-w-3xl leading-relaxed">
          A case cannot be closed while the current load still raises its exceptions. If the
          exception is understood and accepted rather than fixed, record it as accepted risk and
          say why; that is a different claim from remediated and the record should not conflate
          them.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[12px] uppercase tracking-wider text-navy-400 font-semibold">State</span>
            <select className={`${input} mt-1.5`} value={state} onChange={(e) => setState(e.target.value)}>
              {states.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[12px] uppercase tracking-wider text-navy-400 font-semibold">Owning organisation</span>
            <input className={`${input} mt-1.5`} value={ownerOrg} onChange={(e) => setOwnerOrg(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-[12px] uppercase tracking-wider text-navy-400 font-semibold">Due date</span>
            <input className={`${input} mt-1.5`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-[12px] uppercase tracking-wider text-navy-400 font-semibold">Note</span>
            <input className={`${input} mt-1.5`} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-[12px] uppercase tracking-wider text-navy-400 font-semibold">Root cause</span>
            <textarea className={`${input} mt-1.5 h-20`} value={rootCause}
              placeholder="A mechanism, not a symptom."
              onChange={(e) => setRootCause(e.target.value)} />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-[12px] uppercase tracking-wider text-navy-400 font-semibold">Corrective action</span>
            <textarea className={`${input} mt-1.5 h-20`} value={correctiveAction}
              placeholder="The control to be installed, and the test that will show it operating."
              onChange={(e) => setCorrectiveAction(e.target.value)} />
          </label>
        </div>
        <button className={`${btn} mt-4 border-accent-500/40 bg-accent-500/12 text-accent-400`}
          disabled={busy === 'state' || !writable || !token} onClick={move}>
          {busy === 'state' ? 'saving…' : 'Record'}
        </button>
      </div>
    </div>
  );
}
