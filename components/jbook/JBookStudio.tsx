'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JBook, JBookYear, JBookSkeletonRow, JBookExemplar, LexiconEntry } from '@/lib/jbook';
import type { Draft, DraftSection, ReadinessCheck } from '@/lib/jbook-draft';

/**
 * One book at a time.
 *
 * The first cut of this page put every Defense-Wide RDT&E book into a single
 * R-2 skeleton and asked for eight fields before anything could be written.
 * Both were wrong. A justification book is a specific document with a specific
 * history -- DISA's OP-5 has fifteen editions here and dropped a section in
 * PB2021 -- and a drafter arrives wanting THAT book, not an average of all of
 * them. So: choose the book, see its own format and its own drift, then write
 * against it with one field filled in.
 *
 * Nothing here invents a figure. The scaffold is placeholders; the model, when
 * one is reachable, is told to write bracketed placeholders rather than numbers
 * it was not given; and the readiness check looks for the placeholders that
 * survived.
 */

interface Fund { fundKey: string; fundLabel: string; books: number; editions: number;
                 current: number; firstPbYear: number; latestPbYear: number }
interface Hit { phrase: string; severity: 'block' | 'warn'; category: string; rationale: string;
                suggestion: string | null; authority: string | null; letter: string;
                index: number; excerpt: string }

const INPUT = 'w-full px-3 py-2 rounded-lg bg-navy-800 border border-navy-700 text-sm '
  + 'text-navy-100 placeholder:text-navy-500 focus:outline-none focus:ring-2 focus:ring-accent-500';
const BTN = 'px-4 py-2 rounded-lg bg-accent-500 text-navy-950 text-sm font-semibold '
  + 'hover:bg-accent-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN2 = 'px-3 py-2 rounded-lg bg-navy-800 border border-navy-700 text-sm text-navy-200 '
  + 'hover:border-navy-600 transition-colors disabled:opacity-40';

const wordCount = (s: string) => (s.trim().match(/\b[\w'-]+\b/g) ?? []).length;

export default function JBookStudio({ funds, initialBooks, initialFund, lexicon, llmOnline }: {
  funds: Fund[];
  initialBooks: JBook[];
  initialFund: string;
  lexicon: LexiconEntry[];
  llmOnline: boolean;
}) {
  const [fund, setFund] = useState(initialFund);
  const [q, setQ] = useState('');
  const [books, setBooks] = useState<JBook[]>(initialBooks);
  const [loading, setLoading] = useState(false);
  const [book, setBook] = useState<JBook | null>(null);
  const [years, setYears] = useState<JBookYear[]>([]);
  const [skeleton, setSkeleton] = useState<JBookSkeletonRow[]>([]);
  const [nextPb, setNextPb] = useState<number | null>(null);
  const [openYear, setOpenYear] = useState<number | null>(null);
  const [yearSections, setYearSections] = useState<any[]>([]);

  // the draft
  const [subject, setSubject] = useState('');
  const [pbYear, setPbYear] = useState<number | ''>('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [checks, setChecks] = useState<ReadinessCheck[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [instruction, setInstruction] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try { const t = sessionStorage.getItem('jbookToken'); if (t) setToken(t); } catch { /* private mode */ }
  }, []);
  useEffect(() => { try { if (token) sessionStorage.setItem('jbookToken', token); } catch { /* ignore */ } },
    [token]);

  // deep link: /jbook?book=om/disaop5
  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('book');
    if (k) selectBook(k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const r = await fetch('/api/jbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-jbook-token': token },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, ...j } as any;
  }, [token]);

  const loadBooks = useCallback(async (f: string, search: string) => {
    setLoading(true);
    // A search crosses every appropriation. Confining it to the selected fund
    // is how you type "DISA" while RDT&E is selected and are told the archive
    // holds nothing called DISA, when it holds eleven of them.
    const u = new URLSearchParams({ action: 'books', limit: '400' });
    if (search.trim()) u.set('q', search.trim());
    else if (f) u.set('fund', f);
    const r = await fetch(`/api/jbook?${u}`).then((x) => x.json()).catch(() => ({ books: [] }));
    setBooks(r.books ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => { loadBooks(fund, q); }, q ? 300 : 0);
    return () => clearTimeout(id);
  }, [fund, q, loadBooks]);

  async function selectBook(key: string) {
    setBusy('book');
    const r = await fetch(`/api/jbook?action=book&key=${encodeURIComponent(key)}`)
      .then((x) => x.json()).catch(() => null);
    setBusy(null);
    if (!r?.book) { setMsg({ kind: 'err', text: 'That book could not be loaded.' }); return; }
    setBook(r.book); setYears(r.years); setSkeleton(r.skeleton); setNextPb(r.nextPbYear);
    setDraft(null); setChecks([]); setHits([]); setOpenYear(null); setYearSections([]);
    setPbYear(r.nextPbYear);
    window.history.replaceState(null, '', `/jbook?book=${encodeURIComponent(key)}#write`);
  }

  async function showYear(pb: number) {
    if (!book) return;
    if (openYear === pb) { setOpenYear(null); return; }
    setOpenYear(pb);
    const r = await fetch(`/api/jbook?action=bookYear&key=${encodeURIComponent(book.bookKey)}&pb=${pb}`)
      .then((x) => x.json()).catch(() => ({ sections: [] }));
    setYearSections(r.sections ?? []);
  }

  async function buildDraft() {
    if (!book) return;
    setBusy('draft');
    const r = await post({ action: 'draft', bookKey: book.bookKey, subject,
      pbYear: pbYear || undefined });
    setBusy(null);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error ?? 'the scaffold could not be built' }); return; }
    setDraft(r.draft);
    setMsg({ kind: 'info', text: `Scaffold built from ${r.editions} edition(s) of this book. `
      + 'Every body is a placeholder — nothing has been written for you and no figure has been supplied.' });
  }

  const setBody = (key: string, body: string) => setDraft((d) => d && ({
    ...d, sections: d.sections.map((s) => (s.key === key ? { ...s, body } : s)) }));

  // The screen runs on the server on every pause, so what is shown is what a
  // save will enforce.
  useEffect(() => {
    if (!draft) { setHits([]); return; }
    const filled = draft.sections.filter((s) => s.body.trim());
    if (!filled.length) { setHits([]); setChecks([]); return; }
    const id = setTimeout(async () => {
      const r = await post({ action: 'readiness', draft });
      if (r.checks) { setChecks(r.checks); setHits(r.hits ?? []); }
    }, 700);
    return () => clearTimeout(id);
  }, [draft, post]);

  async function compose(section: DraftSection, extra?: string) {
    if (!book || !draft) return;
    setBusy(`compose:${section.key}`);
    const r = await post({ action: 'compose', bookKey: book.bookKey, normTitle: section.key,
      title: section.title, subject: draft.subject, pbYear: draft.pbYear,
      instruction: extra ?? instruction,
      current: section.body.startsWith('[') ? '' : section.body });
    setBusy(null);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error ?? 'the model could not be reached' }); return; }
    setBody(section.key, r.text.trim());
    setMsg({ kind: 'ok', text: `${section.title} drafted by ${r.model}`
      + `${r.blocking ? ` — ${r.blocking} phrase(s) the screen refuses are in it` : ''}. `
      + 'Read it before you keep it.' });
  }

  const docKey = useMemo(() => (book && draft
    ? `${book.bookKey.replace(/[^a-z0-9]+/gi, '-')}-PB${draft.pbYear}` : ''), [book, draft]);

  async function save(force = false) {
    if (!book || !draft || !docKey) return;
    setBusy('save');
    const d = await post({ action: 'saveDoc', doc: {
      docKey, exhibit: (book.exhibits ?? 'book').split(',')[0], pbYear: draft.pbYear,
      component: book.title, fundLabel: book.fundLabel, basedOnSlug: book.bookKey } });
    if (!d.ok) { setBusy(null); setMsg({ kind: 'err', text: d.error ?? 'could not save the document' }); return; }
    const content = { bookKey: book.bookKey, subject: draft.subject, pbYear: draft.pbYear,
      sections: draft.sections.map(({ key, mark, title, body }) => ({ letter: mark ?? '', key, title, body })) };
    const v = await post({ action: 'saveVersion', docKey, content, force,
      note: force ? 'saved with phrases the screen refuses present' : null });
    setBusy(null);
    if (v.status === 409) {
      setMsg({ kind: 'err', text: v.message ?? 'blocked by the screen' });
      if (v.hits) setHits(v.hits);
      return;
    }
    if (!v.ok) { setMsg({ kind: 'err', text: v.error ?? 'could not save' }); return; }
    setMsg({ kind: 'ok', text: `Saved version ${v.saved.versionNo} of ${docKey}.` });
    loadVersions();
  }

  const loadVersions = useCallback(async () => {
    if (!docKey) return;
    const j = await fetch(`/api/jbook?action=doc&key=${encodeURIComponent(docKey)}`)
      .then((x) => x.json()).catch(() => ({}));
    setVersions(j.versions ?? []);
  }, [docKey]);
  useEffect(() => { loadVersions(); }, [loadVersions]);

  async function onDocx(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !draft) return;
    setBusy('import');
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    buf.forEach((b) => { bin += String.fromCharCode(b); });
    const r = await post({ action: 'importDocx', file: btoa(bin), name: f.name,
      docKey: docKey || undefined,
      expected: draft.sections.map((s) => ({ key: s.key, title: s.title })) });
    setBusy(null);
    if (fileRef.current) fileRef.current.value = '';
    if (!r.ok) { setMsg({ kind: 'err', text: r.error ?? 'that file could not be read' }); return; }
    setDraft((d) => d && ({ ...d, sections: d.sections.map((s) => {
      const found = (r.sections as any[]).find((x) => x.key === s.key);
      return found ? { ...s, body: found.body } : s;
    }) }));
    const stray = (r.sections as any[]).filter((x) => !x.matched && x.body.trim().length > 40);
    setMsg({ kind: 'ok', text: `${r.matched} section(s) matched by heading and brought back in`
      + `${stray.length ? `; ${stray.length} block(s) of text did not match a heading and were left out `
        + 'of the sections — they are still in the file you uploaded' : ''}`
      + `${r.saved ? `, saved as version ${r.saved.versionNo}` : ''}.` });
  }

  const blocking = checks.filter((c) => c.status === 'block');
  const warnings = checks.filter((c) => c.status === 'warn');
  const dropped = skeleton.filter((s) => !s.isCurrent && s.yearsSeen >= 2)
    .sort((a, b) => b.lastSeenPb - a.lastSeenPb);

  return (
    <div className="space-y-12">
      {/* ============================================================ 1. pick */}
      <div>
        <h3 className="text-sm font-semibold text-navy-200 mb-3">
          1 · Which book
          <span className="ml-3 font-normal text-[12px] text-navy-500">
            {funds.reduce((s, f) => s + f.books, 0).toLocaleString()} books,{' '}
            {funds.reduce((s, f) => s + f.editions, 0).toLocaleString()} editions held
          </span>
        </h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {funds.map((f) => (
            <button key={f.fundKey} onClick={() => { setFund(f.fundKey); setQ(''); }}
              className={`text-[12px] px-3 py-1.5 rounded-full border transition-colors ${
                fund === f.fundKey
                  ? 'border-accent-500 text-accent-400'
                  : 'border-navy-800 text-navy-400 hover:border-navy-600'}`}>
              {f.fundLabel}
              <span className="text-navy-500 ml-1.5">{f.books}</span>
            </button>
          ))}
        </div>
        <input className={INPUT} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search every book, in every appropriation — DISA, BRAC, Missile Defense, OP-5…" />
        {q.trim() && (
          <p className="text-[12px] text-navy-500 mt-1.5">
            Searching all {funds.reduce((s2, f) => s2 + f.books, 0).toLocaleString()} books, not just{' '}
            {funds.find((f) => f.fundKey === fund)?.fundLabel ?? 'the selected appropriation'}.
          </p>
        )}
        <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-navy-800 divide-y divide-navy-800/70">
          {loading && <p className="px-4 py-3 text-[13px] text-navy-500">looking…</p>}
          {!loading && books.length === 0 && (
            <p className="px-4 py-3 text-[13px] text-navy-400">
              Nothing in the archive matched that search. It holds Defense-Wide and
              Department-level books; a service book that is not here has not been collected.
            </p>
          )}
          {books.map((b) => (
            <button key={b.bookKey} onClick={() => selectBook(b.bookKey)}
              className={`w-full text-left px-4 py-2.5 hover:bg-navy-800/60 transition-colors ${
                book?.bookKey === b.bookKey ? 'bg-navy-800/80' : ''}`}>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-sm text-navy-100">{b.title}</span>
                <span className="text-[12px] text-navy-500">
                  {b.yearsHeld} edition{b.yearsHeld === 1 ? '' : 's'} · PB{b.firstPbYear}–PB{b.latestPbYear}
                </span>
                {b.isCurrent && <span className="text-[12px] text-accent-400">current</span>}
                {!b.hasText && <span className="text-[12px] text-navy-500">scanned — no text layer</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ====================================================== 2. this book */}
      {book && (
        <div>
          <h3 className="text-sm font-semibold text-navy-200 mb-1">
            2 · {book.title} — what its own editions show
          </h3>
          <p className="text-[13px] text-navy-400 leading-relaxed mb-4 max-w-3xl">
            Measured across this book alone, weighted towards its recent editions. The share is
            recency-weighted on a three-year half-life, so a section printed in every edition since
            PB2020 outranks one dropped a decade ago — and the ones it has stopped printing are
            listed underneath rather than quietly removed.
          </p>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Tile label="Editions held" value={String(book.yearsHeld)}
              sub={`PB${book.firstPbYear}–PB${book.latestPbYear}`} />
            <Tile label="Pages read" value={book.pages.toLocaleString()}
              sub={book.exhibits ? `exhibits: ${book.exhibits}` : 'no exhibit tag printed'} />
            <Tile label="Sections observed" value={book.sections.toLocaleString()}
              sub={`${skeleton.length} distinct section titles`} />
            {/* Both halves of this are counted the same way -- section ROWS per
                edition, not section occurrences -- because dividing rows by
                occurrences produced a 6% that sat above a table of 76% and
                100%, and looked like the table was wrong. */}
            <Tile label="Time-sensitive" value={`${Math.round(
              (book.timeSections / Math.max(1, years.reduce((a, y) => a + y.titles, 0))) * 100)}%`}
              sub="of its sections carry a date, a schedule or a milestone" tone="accent" />
          </div>

          <div className="flex flex-wrap gap-1.5 mb-6">
            {years.map((y) => (
              <button key={y.pbYear} onClick={() => showYear(y.pbYear)}
                className={`text-[12px] px-2.5 py-1 rounded border transition-colors ${
                  openYear === y.pbYear ? 'border-accent-500 text-accent-400'
                    : y.isLatest ? 'border-accent-500/40 text-navy-200'
                    : 'border-navy-800 text-navy-400 hover:border-navy-600'}`}
                title={`${y.titles} sections, ${y.pages} pages, weight ${y.recencyWeight}`
                  + `${y.pbBasis === 'document' ? ' · year from the book’s own cover' : ' · year from the archive folder'}`}>
                PB{y.pbYear}
              </button>
            ))}
          </div>
          {openYear && (
            <div className="mb-6 rounded-lg border border-navy-800 p-4">
              <p className="text-[12px] text-navy-500 mb-2">
                What PB{openYear} printed, in the order it printed it
                {years.find((y) => y.pbYear === openYear)?.sourceFile
                  ? ` · ${years.find((y) => y.pbYear === openYear)?.sourceFile}` : ''}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {yearSections.map((s, i) => (
                  <span key={i} className="text-[12px] text-navy-300">
                    {s.mark ? <span className="font-mono text-accent-300">{s.mark}. </span> : null}
                    {s.title}
                    <span className="text-navy-500"> ({s.medianWords}w{s.occurrences > 1
                      ? ` ×${s.occurrences}` : ''})</span>
                  </span>
                ))}
                {yearSections.length === 0 && (
                  <span className="text-[12px] text-navy-500">
                    No lettered or numbered headings were extracted from this edition. It may be a
                    table-only book or a scan.
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[12px] uppercase tracking-wider text-navy-500 border-b border-navy-800">
                  <th className="py-2 pr-4 font-semibold">Section</th>
                  <th className="py-2 pr-4 font-semibold">Weighted share</th>
                  <th className="py-2 pr-4 font-semibold">Editions</th>
                  <th className="py-2 pr-4 font-semibold">Words</th>
                  <th className="py-2 pr-4 font-semibold">Dated content</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-800/60">
                {skeleton.filter((s) => s.isCurrent).slice(0, 24).map((s) => (
                  <tr key={s.normTitle}>
                    <td className="py-2 pr-4 text-sm text-navy-100">
                      {s.mark && <span className="font-mono text-accent-300 mr-1.5">{s.mark}.</span>}
                      {s.title}
                    </td>
                    <td className="py-2 pr-4 text-sm text-accent-300">{s.weightedSharePct}%</td>
                    <td className="py-2 pr-4 text-[12px] text-navy-400">
                      {s.yearsSeen} of {s.yearsTotal}
                      <span className="block text-navy-500">PB{s.firstSeenPb}–PB{s.lastSeenPb}</span>
                    </td>
                    <td className="py-2 pr-4 text-[12px] text-navy-400">
                      {s.medianWords}
                      <span className="text-navy-500"> ({s.p10Words}–{s.p90Words})</span>
                    </td>
                    <td className="py-2 pr-4 text-[12px]">
                      <span className={Number(s.timeSharePct) >= 50 ? 'text-accent-400' : 'text-navy-500'}>
                        {s.timeSharePct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {dropped.length > 0 && (
            <p className="text-[13px] text-navy-400 mt-4 leading-relaxed max-w-3xl">
              <strong className="text-navy-200">This book has stopped printing:</strong>{' '}
              {dropped.slice(0, 6).map((s, i) => (
                <span key={s.normTitle}>
                  {i > 0 ? '; ' : ''}
                  <span className="text-navy-200">{s.title}</span> (PB{s.firstSeenPb}–PB{s.lastSeenPb})
                </span>
              ))}. Sections a book dropped are not scaffolded into a new one, but they are shown
              here, because a format change is a fact about the book and not a gap in the extract.
            </p>
          )}
        </div>
      )}

      {/* ======================================================== 3. write it */}
      {book && (
        <div id="write">
          <h3 className="text-sm font-semibold text-navy-200 mb-1">3 · Write the next one</h3>
          <p className="text-[13px] text-navy-400 leading-relaxed mb-4 max-w-3xl">
            One field. The year defaults to the next President&rsquo;s Budget after the newest edition
            held{nextPb ? ` — PB${nextPb}` : ''}, and everything else comes from the book itself.
            Leave the subject empty and you get the bare skeleton.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input className={INPUT} value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="What is this book for? e.g. “Defense Information Systems Agency, BA 4 administration”" />
            <input className={`${INPUT} sm:w-36`} value={pbYear}
              onChange={(e) => setPbYear(e.target.value ? Number(e.target.value) : '')}
              placeholder="PB year" />
            <button className={BTN} onClick={buildDraft} disabled={busy === 'draft'}>
              {busy === 'draft' ? 'building…' : draft ? 'Rebuild' : 'Draft it'}
            </button>
          </div>

          {draft && (
            <>
              <p className="text-[12px] text-navy-500 mb-5 leading-relaxed max-w-3xl">{draft.note}</p>
              <div className="space-y-6">
                {draft.sections.map((s) => {
                  const n = wordCount(s.body);
                  const placeheld = /\[[^\]]{3,}\]/.test(s.body);
                  const low = s.lowWords ?? 0, high = s.highWords ?? 0;
                  const outside = !placeheld && n > 0 && high > 0 && (n < low || n > high);
                  return (
                    <div key={s.key} className="rounded-lg border border-navy-800 p-4">
                      <div className="flex flex-wrap items-baseline gap-x-3 mb-1.5">
                        <h4 className="text-sm font-semibold text-navy-100">
                          {s.mark && <span className="font-mono text-accent-300 mr-1.5">{s.mark}.</span>}
                          {s.title}
                        </h4>
                        {s.isRequired && <span className="text-[12px] text-accent-400">required</span>}
                        {Number(s.timeSharePct ?? 0) >= 50 && (
                          <span className="text-[12px] text-amber-300">carries dates in the published book</span>
                        )}
                        <span className={`ml-auto text-[12px] ${outside ? 'text-amber-300' : 'text-navy-500'}`}>
                          {n} words{high ? ` · this book runs ${low}–${high}` : ''}
                        </span>
                      </div>
                      <p className="text-[12px] text-navy-500 mb-2 leading-relaxed">{s.guidance}</p>
                      <textarea className={`${INPUT} min-h-[9rem] font-[inherit] leading-relaxed`}
                        value={s.body} onChange={(e) => setBody(s.key, e.target.value)} />
                      <div className="flex flex-wrap gap-2 mt-2">
                        <button className={BTN2} disabled={!llmOnline || !token || busy === `compose:${s.key}`}
                          onClick={() => compose(s)}
                          title={!llmOnline ? 'The local model server is not reachable'
                            : !token ? 'An authoring token is needed' : 'Draft this section on the local model'}>
                          {busy === `compose:${s.key}` ? 'drafting…' : 'Draft on the local model'}
                        </button>
                        <ExamplePassages bookKey={book.bookKey} normTitle={s.key} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ------------------------------------------- instruction box */}
              <div className="mt-6 rounded-lg border border-navy-800 p-4">
                <h4 className="text-sm font-semibold text-navy-200 mb-2">
                  Tell it what to change
                </h4>
                <p className="text-[12px] text-navy-500 mb-2 leading-relaxed">
                  A comment applies to the next section you draft — &ldquo;shorter, and state the
                  transition date&rdquo;, &ldquo;name the two systems and drop the adjectives&rdquo;.
                  What comes back lands in the box for you to read, never straight into a saved version.
                </p>
                <input className={INPUT} value={instruction} onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Instruction or comment for the next draft" />
              </div>

              {/* ----------------------------------------------- readiness */}
              <div className="mt-8">
                <h4 className="text-sm font-semibold text-navy-200 mb-2">
                  Before it goes
                  <span className="ml-3 font-normal text-[12px] text-navy-500">
                    {blocking.length} blocking, {warnings.length} worth a second look
                  </span>
                </h4>
                <ul className="space-y-2">
                  {checks.slice(0, 14).map((c) => (
                    <li key={c.id} className={`rounded-lg border px-4 py-2.5 ${
                      c.status === 'block' ? 'border-red-500/40 bg-red-500/[0.05]'
                        : c.status === 'warn' ? 'border-amber-500/30 bg-amber-500/[0.04]'
                        : 'border-navy-800'}`}>
                      <div className="flex flex-wrap items-baseline gap-x-3">
                        <span className={`text-[12px] uppercase tracking-wider font-semibold ${
                          c.status === 'block' ? 'text-red-300'
                            : c.status === 'warn' ? 'text-amber-300' : 'text-accent-400'}`}>
                          {c.status === 'block' ? 'blocks a save' : c.status === 'warn' ? 'review' : 'ready'}
                        </span>
                        <span className="text-sm text-navy-100">{c.label}</span>
                        {c.section && <span className="text-[12px] text-navy-500">{c.section}</span>}
                      </div>
                      <p className="text-[12px] text-navy-400 mt-1 leading-relaxed">{c.detail}</p>
                    </li>
                  ))}
                  {checks.length === 0 && (
                    <li className="text-[13px] text-navy-500">
                      The check runs as you write. Nothing has been typed into a section yet.
                    </li>
                  )}
                </ul>
              </div>

              {/* -------------------------------------------------- saving */}
              <div className="mt-8 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] uppercase tracking-wider text-navy-500">Authoring token</span>
                  <input className={`${INPUT} sm:w-64`} type="password" value={token}
                    onChange={(e) => setToken(e.target.value)} placeholder="required to save or export" />
                </label>
                <button className={BTN} disabled={!token || busy === 'save'} onClick={() => save(false)}>
                  {busy === 'save' ? 'saving…' : 'Save a version'}
                </button>
                <button className={BTN2} disabled={!token || !blocking.length} onClick={() => save(true)}
                  title="Save anyway, recording what was present">
                  Save with the override recorded
                </button>
                <a className={BTN2} href={docKey ? `/api/jbook/export?key=${encodeURIComponent(docKey)}` : '#'}
                  aria-disabled={!versions.length}>Export .docx</a>
                <button className={BTN2} disabled={!token || busy === 'import'}
                  onClick={() => fileRef.current?.click()}>
                  {busy === 'import' ? 'reading…' : 'Upload a revised .docx'}
                </button>
                <input ref={fileRef} type="file" accept=".docx" className="hidden" onChange={onDocx} />
              </div>
              {versions.length > 0 && (
                <p className="text-[12px] text-navy-500 mt-3">
                  {versions.length} version{versions.length === 1 ? '' : 's'} of {docKey}:{' '}
                  {versions.slice(0, 6).map((v) => `v${v.versionNo} ${v.createdAt}`
                    + (v.origin === 'import' ? ' (imported)' : '')
                    + (v.screenHits ? ` · ${v.screenHits} flagged` : '')).join(' · ')}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {msg && (
        <p className={`text-[13px] ${msg.kind === 'err' ? 'text-red-300'
          : msg.kind === 'ok' ? 'text-accent-400' : 'text-navy-400'}`}>{msg.text}</p>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'accent' }) {
  return (
    <div className="rounded-lg border border-navy-800 px-4 py-3">
      <p className="text-[12px] uppercase tracking-wider text-navy-500">{label}</p>
      <p className={`text-xl font-bold ${tone === 'accent' ? 'text-accent-400' : 'text-navy-50'}`}>{value}</p>
      <p className="text-[12px] text-navy-500 mt-0.5 leading-snug">{sub}</p>
    </div>
  );
}

/** The published passages for this section of this book, on demand. */
function ExamplePassages({ bookKey, normTitle }: { bookKey: string; normTitle: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<JBookExemplar[] | null>(null);
  async function toggle() {
    setOpen((o) => !o);
    if (rows) return;
    const r = await fetch(`/api/jbook?action=bookExemplars&key=${encodeURIComponent(bookKey)}`
      + `&title=${encodeURIComponent(normTitle)}&limit=2`)
      .then((x) => x.json()).catch(() => ({ exemplars: [] }));
    setRows(r.exemplars ?? []);
  }
  return (
    <div className="w-full">
      <button className={BTN2} onClick={toggle}>
        {open ? 'Hide the published version' : 'Show how the book published this'}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {rows === null && <p className="text-[12px] text-navy-500">looking…</p>}
          {rows?.length === 0 && (
            <p className="text-[12px] text-navy-400 leading-relaxed">
              No passage is held for this section. Text is kept only for a book&rsquo;s two most recent
              editions; older editions contribute the structure and the word bands above.
            </p>
          )}
          {rows?.map((e, i) => (
            <div key={i} className="rounded border border-navy-800 bg-navy-900/40 px-4 py-3">
              <p className="text-[12px] font-mono text-navy-500 mb-1.5">
                PB{e.pbYear} · {e.sourceFile} · page {e.pageNo} · {e.words} words
                {e.timeHits ? ` · ${e.timeHits} dated statements` : ''}
              </p>
              <p className="text-[13px] text-navy-300 leading-relaxed">
                {e.body.slice(0, 1200)}{e.body.length > 1200 ? '…' : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
