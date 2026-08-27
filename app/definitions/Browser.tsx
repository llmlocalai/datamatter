'use client';
import { useMemo, useState } from 'react';
import type { Definition } from '@/lib/analytics';

export default function DefinitionBrowser({ defs }: { defs: Definition[] }) {
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState('All');
  const [open, setOpen] = useState<string | null>(null);

  const topics = useMemo(
    () => ['All', ...Array.from(new Set(defs.map((d) => d.topic || 'General'))).sort()],
    [defs]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return defs.filter((d) =>
      (topic === 'All' || (d.topic || 'General') === topic) &&
      (!needle || d.term.toLowerCase().includes(needle) ||
        d.definition.toLowerCase().includes(needle) ||
        d.authorities.join(' ').toLowerCase().includes(needle)));
  }, [defs, q, topic]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search terms, definitions, or authorities…"
          aria-label="Search definitions"
          className="flex-1 bg-navy-900 border border-navy-700 rounded-lg px-4 py-2.5 text-sm text-navy-50 placeholder:text-navy-500 focus:outline-none focus:border-accent-500"
        />
        <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Filter by topic"
          className="bg-navy-900 border border-navy-700 rounded-lg px-3 py-2.5 text-sm text-navy-200 focus:outline-none focus:border-accent-500">
          {topics.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <p className="text-xs text-navy-500 mb-4 tnum">
        {shown.length} of {defs.length} terms
      </p>
      <div className="space-y-2.5">
        {shown.map((d) => {
          const isOpen = open === d.slug;
          return (
            <article key={d.slug} className="glass-card rounded-lg overflow-hidden">
              <button
                onClick={() => setOpen(isOpen ? null : d.slug)}
                aria-expanded={isOpen}
                className="w-full text-left px-5 py-4 hover:bg-navy-800/30 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-navy-50 font-semibold text-sm">{d.term}</h3>
                    <p className={`text-sm text-navy-300 mt-1.5 leading-relaxed ${isOpen ? '' : 'line-clamp-2'}`}>
                      {d.definition}
                    </p>
                  </div>
                  <span className="shrink-0 flex flex-col items-end gap-1.5">
                    {d.topic && (
                      <span className="text-[10px] uppercase tracking-wider text-navy-400 bg-navy-800/70 px-2 py-0.5 rounded">
                        {d.topic}
                      </span>
                    )}
                    <span className="text-navy-500 text-xs" aria-hidden>{isOpen ? '−' : '+'}</span>
                  </span>
                </div>
              </button>
              {isOpen && (
                <div className="px-5 pb-5 pt-1 space-y-4 border-t border-navy-800/60">
                  {d.whyItMatters && (
                    <div>
                      <h4 className="text-[10px] uppercase tracking-wider text-accent-400 font-semibold mb-1.5">Why it matters</h4>
                      <p className="text-sm text-navy-300 leading-relaxed">{d.whyItMatters}</p>
                    </div>
                  )}
                  {d.keyRules && (
                    <div>
                      <h4 className="text-[10px] uppercase tracking-wider text-accent-400 font-semibold mb-1.5">Key rules</h4>
                      <p className="text-sm text-navy-300 leading-relaxed whitespace-pre-line">{d.keyRules}</p>
                    </div>
                  )}
                  <div>
                    <h4 className="text-[10px] uppercase tracking-wider text-accent-400 font-semibold mb-1.5">Authoritative sources</h4>
                    <ul className="space-y-1">
                      {d.authorities.map((a, i) => (
                        <li key={i} className="text-xs text-navy-300 font-mono leading-relaxed">· {a}</li>
                      ))}
                    </ul>
                  </div>
                  <p className="text-[11px] text-navy-500 font-mono">
                    source {d.sourceFile}{d.lastVerified ? ` · last verified ${d.lastVerified}` : ''}
                  </p>
                </div>
              )}
            </article>
          );
        })}
        {!shown.length && <p className="text-sm text-navy-500 italic py-8">No term matches that filter.</p>}
      </div>
    </div>
  );
}
