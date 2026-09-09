'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * The authoring surface.
 *
 * Screening runs against the server on every pause in typing rather than in the
 * browser, so the rule set is the one the server will enforce on save and the
 * two can never disagree. Nothing is stripped automatically: a forbidden phrase
 * is shown with the reason and a suggestion, and the person writing decides what
 * the sentence should say instead.
 */

export interface SkeletonRow {
  letter: string; title: string; isTable: boolean;
  sharePct: number; isRequired: boolean;
}
export interface StyleRow {
  component: string; letter: string; title: string; sampleSize: number;
  medianWords: number; minWords: number; maxWords: number;
  avgSentenceWords: number | null; exampleOpening: string | null;
}
export interface LexRow {
  id: number; phrase: string; severity: 'block' | 'warn'; category: string;
  rationale: string; suggestion: string | null; authority: string | null;
  isSeed: boolean; isActive: boolean;
}
interface Hit {
  phrase: string; severity: 'block' | 'warn'; category: string; rationale: string;
  suggestion: string | null; letter: string; index: number; excerpt: string;
}

const INPUT = 'w-full px-3 py-2 rounded-lg bg-navy-800 border border-navy-700 text-sm '
  + 'text-navy-100 placeholder:text-navy-600 focus:outline-none focus:ring-2 focus:ring-accent-500';
const BTN = 'px-4 py-2 rounded-lg bg-accent-500 text-navy-950 text-sm font-semibold '
  + 'hover:bg-accent-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN2 = 'px-3 py-2 rounded-lg bg-navy-800 border border-navy-700 text-sm text-navy-200 '
  + 'hover:border-navy-600 transition-colors disabled:opacity-40';

function words(s: string) { return (s.trim().match(/\b[\w'-]+\b/g) ?? []).length; }

export default function Composer({ skeleton, styles, lexicon, components }: {
  skeleton: SkeletonRow[]; styles: StyleRow[]; lexicon: LexRow[];
  components: { component: string; exhibits: number }[];
}) {
  const [token, setToken] = useState('');
  const [component, setComponent] = useState(components[0]?.component ?? '');
  const [meta, setMeta] = useState({
    docKey: '', pbYear: 2027, pe: '', peTitle: '', appropriationCode: '0400',
    appropriation: 'Research, Development, Test & Evaluation, Defense-Wide',
    budgetActivity: '', budgetActivityTitle: '', r1Line: '',
  });
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [hits, setHits] = useState<Hit[]>([]);
  const [screening, setScreening] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [lex, setLex] = useState(lexicon);
  const [newPhrase, setNewPhrase] = useState({ phrase: '', rationale: '', suggestion: '', severity: 'block' });
  const [versions, setVersions] = useState<any[]>([]);
  const [uploadDraft, setUploadDraft] = useState({ name: '', kind: 'table', content: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { const t = sessionStorage.getItem('jbookToken'); if (t) setToken(t); } catch { /* private mode */ }
  }, []);
  useEffect(() => {
    try { if (token) sessionStorage.setItem('jbookToken', token); } catch { /* ignore */ }
  }, [token]);

  const sections = useMemo(
    () => skeleton.map((s) => ({ ...s, body: bodies[s.letter] ?? '' })), [skeleton, bodies]);

  const styleFor = useCallback(
    (letter: string) => styles.find((s) => s.component === component && s.letter === letter)
      ?? styles.find((s) => s.letter === letter),
    [styles, component]);

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const r = await fetch('/api/jbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-jbook-token': token },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, ...j } as any;
  }, [token]);

  // screen on a pause, against the server, so the rules cannot drift
  useEffect(() => {
    const payload = sections.filter((s) => s.body.trim()).map((s) => ({ letter: s.letter, body: s.body }));
    if (!payload.length) { setHits([]); return; }
    const id = setTimeout(async () => {
      setScreening(true);
      const r = await post({ action: 'screen', sections: payload });
      if (r.hits) setHits(r.hits);
      setScreening(false);
    }, 700);
    return () => clearTimeout(id);
  }, [sections, post]);

  const blocking = hits.filter((h) => h.severity === 'block');
  const warnings = hits.filter((h) => h.severity === 'warn');
  const docKey = meta.docKey || (meta.pe ? `${meta.pe}-PB${meta.pbYear}` : '');

  async function saveVersion(force = false) {
    if (!docKey) { setMsg({ kind: 'err', text: 'A program element or a document key is needed first.' }); return; }
    setBusy(true);
    const doc = {
      docKey, exhibit: 'R-2', pbYear: Number(meta.pbYear), component,
      fundLabel: 'RDT&E', appropriationCode: meta.appropriationCode,
      appropriation: meta.appropriation, budgetActivity: meta.budgetActivity,
      budgetActivityTitle: meta.budgetActivityTitle, pe: meta.pe, peTitle: meta.peTitle,
      r1Line: meta.r1Line ? Number(meta.r1Line) : null,
    };
    const d = await post({ action: 'saveDoc', doc });
    if (!d.ok) { setMsg({ kind: 'err', text: d.error ?? 'could not save the document' }); setBusy(false); return; }
    const content = { sections: sections.map(({ letter, title, isTable, body }) => ({ letter, title, isTable, body })) };
    const v = await post({ action: 'saveVersion', docKey, content, force, note: force ? 'saved with forbidden phrases present' : null });
    setBusy(false);
    if (v.status === 409) {
      setMsg({ kind: 'err', text: v.message ?? 'blocked by the screen' });
      if (v.hits) setHits(v.hits);
      return;
    }
    if (!v.ok) { setMsg({ kind: 'err', text: v.error ?? 'could not save' }); return; }
    setMsg({ kind: 'ok', text: `Saved version ${v.saved.versionNo}.` });
    loadVersions();
  }

  const loadVersions = useCallback(async () => {
    if (!docKey) return;
    const r = await fetch(`/api/jbook?action=doc&key=${encodeURIComponent(docKey)}`);
    const j = await r.json().catch(() => ({}));
    setVersions(j.versions ?? []);
  }, [docKey]);
  useEffect(() => { loadVersions(); }, [loadVersions]);

  async function addPhrase() {
    if (!newPhrase.phrase.trim()) return;
    setBusy(true);
    const r = await post({ action: 'addPhrase', ...newPhrase });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error ?? 'could not add the phrase' }); return; }
    setLex(r.lexicon);
    setNewPhrase({ phrase: '', rationale: '', suggestion: '', severity: 'block' });
    setMsg({ kind: 'ok', text: `“${r.added.phrase}” added to the lexicon and screening now.` });
  }

  async function addUpload() {
    if (!docKey || !uploadDraft.content.trim()) return;
    setBusy(true);
    const rows = uploadDraft.content.trim().split('\n').length;
    const r = await post({ action: 'addUpload', docKey,
      upload: { ...uploadDraft, name: uploadDraft.name || 'pasted material', rowCount: rows } });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error ?? 'could not attach' }); return; }
    setUploadDraft({ name: '', kind: 'table', content: '' });
    setMsg({ kind: 'ok', text: `Attached ${rows} line${rows === 1 ? '' : 's'} of source material.` });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setUploadDraft({
      name: f.name,
      kind: /\.(csv|tsv)$/i.test(f.name) ? 'table' : 'text',
      content: text.slice(0, 200000),
    });
  }

  return (
    <div className="space-y-10">
      {/* ---------------------------------------------------------- identity */}
      <div>
        <h3 className="text-sm font-semibold text-navy-200 mb-3">1 · What is being written</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-navy-500">Component</span>
            <select className={INPUT} value={component} onChange={(e) => setComponent(e.target.value)}>
              {components.map((c) => (
                <option key={c.component} value={c.component}>
                  {c.component} · {c.exhibits} exhibits held
                </option>
              ))}
            </select>
          </label>
          {([
            ['pe', 'Program element', '0605801KA'],
            ['peTitle', 'Program element title', 'Defense Technical Information Center'],
            ['budgetActivity', 'Budget activity', '6'],
            ['budgetActivityTitle', 'Budget activity title', 'RDT&E Management Support'],
            ['r1Line', 'R-1 line', '196'],
            ['pbYear', 'President’s Budget year', '2027'],
          ] as const).map(([k, label, ph]) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-navy-500">{label}</span>
              <input className={INPUT} placeholder={ph} value={String((meta as any)[k] ?? '')}
                onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        {docKey && (
          <p className="text-[12px] text-navy-500 mt-2 font-mono">document key: {docKey}</p>
        )}
      </div>

      {/* --------------------------------------------------------- the screen */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-navy-200">
            2 · The screen
            <span className="ml-3 font-normal text-[12px] text-navy-500">
              {screening ? 'checking…'
                : `${blocking.length} blocking, ${warnings.length} to review, ${lex.filter((l) => l.isActive).length} phrases active`}
            </span>
          </h3>
        </div>
        {hits.length === 0 ? (
          <p className="text-[13px] text-navy-400">
            Nothing flagged. The screen runs on the server against the same list the save will
            enforce, so what you see here is what will be applied.
          </p>
        ) : (
          <ul className="space-y-2">
            {hits.slice(0, 12).map((h, i) => (
              <li key={i} className={`rounded-lg border px-4 py-3 ${
                h.severity === 'block'
                  ? 'border-red-500/40 bg-red-500/[0.05]' : 'border-amber-500/30 bg-amber-500/[0.04]'}`}>
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className={`text-[11px] uppercase tracking-wider font-semibold ${
                    h.severity === 'block' ? 'text-red-300' : 'text-amber-300'}`}>
                    {h.severity === 'block' ? 'must not appear' : 'review'}
                  </span>
                  <span className="font-mono text-[13px] text-navy-100">{h.phrase}</span>
                  <span className="text-[11px] text-navy-500">section {h.letter} · {h.category}</span>
                </div>
                <p className="text-[12px] text-navy-400 mt-1.5 leading-relaxed">{h.rationale}</p>
                {h.suggestion && (
                  <p className="text-[12px] text-accent-300/90 mt-1">Instead: {h.suggestion}</p>
                )}
                <p className="text-[12px] font-mono text-navy-500 mt-2 break-words">…{h.excerpt}…</p>
              </li>
            ))}
            {hits.length > 12 && (
              <li className="text-[12px] text-navy-500">and {hits.length - 12} more.</li>
            )}
          </ul>
        )}
      </div>

      {/* -------------------------------------------------------- the sections */}
      <div>
        <h3 className="text-sm font-semibold text-navy-200 mb-3">
          3 · The exhibit
          <span className="ml-3 font-normal text-[12px] text-navy-500">
            sections and their order come from the corpus, not from a template someone typed
          </span>
        </h3>
        <div className="space-y-6">
          {skeleton.map((s) => {
            const st = styleFor(s.letter);
            const w = words(bodies[s.letter] ?? '');
            const target = st?.medianWords;
            const off = target ? Math.abs(w - target) / target : 0;
            return (
              <div key={s.letter}>
                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1.5">
                  <label className="text-sm text-navy-100 font-semibold">
                    {s.letter}. {s.title}
                    {s.isTable && <span className="text-navy-500 font-normal"> ($ in Millions)</span>}
                    {s.isRequired
                      ? <span className="ml-2 text-[11px] text-accent-300">required</span>
                      : <span className="ml-2 text-[11px] text-navy-500">
                          appears on {s.sharePct}% of exhibits
                        </span>}
                  </label>
                  {st && (
                    <span className="text-[11px] text-navy-500">
                      {w} words ·{' '}
                      <span className={w === 0 ? '' : off > 0.6 ? 'text-amber-300' : 'text-accent-300'}>
                        house median {st.medianWords}
                      </span>
                      {' '}({st.minWords}–{st.maxWords}), {st.avgSentenceWords}-word sentences,
                      from {st.sampleSize} exhibits
                    </span>
                  )}
                </div>
                <textarea
                  className={`${INPUT} font-serif leading-relaxed`} rows={s.isTable ? 5 : 8}
                  placeholder={st?.exampleOpening
                    ? `How ${component} opens this section: “${st.exampleOpening.slice(0, 150)}…”`
                    : 'Write this section.'}
                  value={bodies[s.letter] ?? ''}
                  onChange={(e) => setBodies({ ...bodies, [s.letter]: e.target.value })} />
              </div>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------- source material */}
      <div>
        <h3 className="text-sm font-semibold text-navy-200 mb-3">4 · Source material</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-navy-500">Name</span>
            <input className={INPUT} placeholder="FY2027 cost build" value={uploadDraft.name}
              onChange={(e) => setUploadDraft({ ...uploadDraft, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-navy-500">Kind</span>
            <select className={INPUT} value={uploadDraft.kind}
              onChange={(e) => setUploadDraft({ ...uploadDraft, kind: e.target.value })}>
              <option value="table">tabular data</option>
              <option value="text">narrative text</option>
              <option value="background">background</option>
              <option value="structured">structured data</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-navy-500">Or upload a file</span>
            <input type="file" accept=".csv,.tsv,.txt,.json,.md" onChange={onFile}
              className="text-[12px] text-navy-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-navy-800 file:text-navy-200" />
          </label>
        </div>
        <textarea className={`${INPUT} mt-3 font-mono text-[12px]`} rows={5}
          placeholder="Paste a table, a cost build, background text or structured data. It is stored with the document so the drafting has a source to cite."
          value={uploadDraft.content}
          onChange={(e) => setUploadDraft({ ...uploadDraft, content: e.target.value })} />
        <button className={`${BTN2} mt-3`} onClick={addUpload} disabled={busy || !docKey || !uploadDraft.content.trim()}>
          Attach to the document
        </button>
      </div>

      {/* --------------------------------------------------------- the lexicon */}
      <div>
        <h3 className="text-sm font-semibold text-navy-200 mb-1">5 · Add a forbidden phrase</h3>
        <p className="text-[12px] text-navy-500 mb-3 max-w-3xl leading-relaxed">
          Stored in a table of its own and never touched by a data refresh. Seeded entries and
          anything added here are screened identically.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          <input className={INPUT} placeholder="phrase, e.g. per issue paper" value={newPhrase.phrase}
            onChange={(e) => setNewPhrase({ ...newPhrase, phrase: e.target.value })} />
          <input className={INPUT} placeholder="why it must not appear" value={newPhrase.rationale}
            onChange={(e) => setNewPhrase({ ...newPhrase, rationale: e.target.value })} />
          <input className={INPUT} placeholder="what to write instead" value={newPhrase.suggestion}
            onChange={(e) => setNewPhrase({ ...newPhrase, suggestion: e.target.value })} />
          <div className="flex gap-2">
            <select className={INPUT} value={newPhrase.severity}
              onChange={(e) => setNewPhrase({ ...newPhrase, severity: e.target.value })}>
              <option value="block">block</option>
              <option value="warn">warn</option>
            </select>
            <button className={BTN} onClick={addPhrase} disabled={busy || !newPhrase.phrase.trim()}>Add</button>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------- save/export */}
      <div className="border-t border-navy-800 pt-6">
        <h3 className="text-sm font-semibold text-navy-200 mb-3">6 · Save, version and export</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-navy-500">Authoring token</span>
            <input className={INPUT} type="password" placeholder="JBOOK_TOKEN" value={token}
              onChange={(e) => setToken(e.target.value)} />
          </label>
          <button className={BTN} onClick={() => saveVersion(false)} disabled={busy || !token || !docKey}>
            Save version
          </button>
          {blocking.length > 0 && (
            <button className={BTN2} onClick={() => saveVersion(true)} disabled={busy || !token}>
              Save anyway, recording {blocking.length} blocking phrase{blocking.length === 1 ? '' : 's'}
            </button>
          )}
          {docKey && versions.length > 0 && (
            <a className={BTN2} href={`/api/jbook/export?key=${encodeURIComponent(docKey)}`}>
              Export latest as DOCX
            </a>
          )}
        </div>
        {msg && (
          <p className={`text-[13px] mt-3 ${
            msg.kind === 'ok' ? 'text-accent-300' : msg.kind === 'err' ? 'text-red-300' : 'text-navy-400'}`}>
            {msg.text}
          </p>
        )}
        {versions.length > 0 && (
          <div className="mt-5">
            <h4 className="text-[12px] uppercase tracking-wider text-navy-500 mb-2">Version history</h4>
            <ul className="space-y-1 text-[13px]">
              {versions.map((v) => (
                <li key={v.versionNo} className="flex flex-wrap gap-x-4 text-navy-300">
                  <span className="font-mono text-accent-300">v{v.versionNo}</span>
                  <span className="text-navy-500">{v.createdAt}</span>
                  <span>{v.wordCount} words</span>
                  <span className={v.screenHits ? 'text-amber-300' : 'text-navy-500'}>
                    {v.screenHits} flagged
                  </span>
                  <span className="text-navy-500">{v.origin}</span>
                  {v.note && <span className="text-navy-500">{v.note}</span>}
                  <a className="text-accent-400 hover:underline"
                     href={`/api/jbook/export?key=${encodeURIComponent(docKey)}&n=${v.versionNo}`}>
                    docx
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
