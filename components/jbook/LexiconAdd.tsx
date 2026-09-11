'use client';

import { useEffect, useState } from 'react';

/**
 * Adding a phrase to the screen.
 *
 * Small on purpose. The lexicon itself is a table on the page; this is the one
 * action that changes it, and it is user-owned data -- the row carries
 * added_by = 'user' and no load reference, so a data refresh replaces the
 * corpus and cannot touch it.
 */
export default function LexiconAdd({ count }: { count: number }) {
  const [token, setToken] = useState('');
  const [phrase, setPhrase] = useState('');
  const [rationale, setRationale] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [severity, setSeverity] = useState('block');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(count);

  useEffect(() => {
    try { const t = sessionStorage.getItem('jbookToken'); if (t) setToken(t); } catch { /* ignore */ }
  }, []);

  const INPUT = 'w-full px-3 py-2 rounded-lg bg-navy-800 border border-navy-700 text-sm '
    + 'text-navy-100 placeholder:text-navy-500 focus:outline-none focus:ring-2 focus:ring-accent-500';

  async function add() {
    if (!phrase.trim()) return;
    setBusy(true);
    const r = await fetch('/api/jbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-jbook-token': token },
      body: JSON.stringify({ action: 'addPhrase', phrase, rationale, suggestion, severity }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.error ?? 'the phrase could not be added'); return; }
    setN(j.lexicon?.length ?? n + 1);
    setPhrase(''); setRationale(''); setSuggestion('');
    setMsg(`“${j.added.phrase}” is screening now. Reload to see it in the table.`);
  }

  return (
    <div className="mt-6 rounded-lg border border-navy-800 p-4">
      <h3 className="text-sm font-semibold text-navy-200 mb-2">Add a phrase of your own</h3>
      <p className="text-[12px] text-navy-500 mb-3 leading-relaxed max-w-3xl">
        Screened exactly like a seeded one, and stored in a table no data refresh touches — a
        refresh replaces the corpus and cannot remove a rule you wrote. {n} phrases are active.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <input className={INPUT} value={phrase} onChange={(e) => setPhrase(e.target.value)}
          placeholder="Phrase" />
        <input className={`${INPUT} lg:col-span-2`} value={rationale}
          onChange={(e) => setRationale(e.target.value)} placeholder="Why it must not appear" />
        <input className={INPUT} value={suggestion} onChange={(e) => setSuggestion(e.target.value)}
          placeholder="Write instead…" />
        <div className="flex gap-2">
          <select className={INPUT} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="block">blocks a save</option>
            <option value="warn">review</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 mt-3">
        <input className={`${INPUT} sm:w-64`} type="password" value={token}
          onChange={(e) => setToken(e.target.value)} placeholder="authoring token" />
        <button onClick={add} disabled={busy || !token || !phrase.trim()}
          className="px-4 py-2 rounded-lg bg-accent-500 text-navy-950 text-sm font-semibold
                     hover:bg-accent-400 transition-colors disabled:opacity-40">
          {busy ? 'adding…' : 'Add'}
        </button>
        {msg && <span className="text-[12px] text-navy-400">{msg}</span>}
      </div>
    </div>
  );
}
