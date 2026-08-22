'use client';

import { useState } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

interface Result {
  page: string;
  section: string;
  text: string;
  source: string;
  authority: number;
  score: number;
}

interface QueryResponse {
  query: string;
  matched: number;
  answer: { page: string; text: string; source: string } | null;
  results: Result[];
  corpus: { doc_count: number; source: string };
}

const SUGGESTIONS = [
  'antideficiency act violation process',
  'FIAR methodology waves',
  'apportionment and reapportionment',
  'defense working capital funds',
  'disbursing officer accountability',
  'budgetary resources statement',
];

function authorityLabel(a: number): { label: string; cls: string } {
  if (a >= 1.35) return { label: 'Primary authority', cls: 'text-accent-300 bg-accent-500/10' };
  if (a >= 1.2) return { label: 'Official guidance', cls: 'text-navy-100 bg-navy-700/60' };
  return { label: 'Reference', cls: 'text-navy-400 bg-navy-800/60' };
}

export default function RegulationQAPage() {
  const [query, setQuery] = useState('');
  const [resp, setResp] = useState<QueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function run(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setError('');
    setResp(null);
    try {
      const r = await fetch(`/api/regulation?q=${encodeURIComponent(q)}&top=8`);
      const d = await r.json();
      if (d.error) setError(d.error);
      setResp(d);
    } catch (e) {
      setError('Query failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
       <main className="min-h-screen bg-navy-950">
         <Navbar />

         <section className="py-20 px-4 sm:px-6 lg:px-8 border-b border-navy-800 grid-pattern">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-block text-xs font-semibold text-accent-400 uppercase tracking-widest mb-4">
              Cited retrieval · DoD-FM knowledge wiki · {75} curated pages
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold text-navy-50 mb-6">
              Regulatory <span className="gradient-text">Q&amp;A</span>
            </h1>
            <p className="text-lg text-navy-300 max-w-2xl mx-auto">
              Ask a question about DoD financial management. Answers are retrieved from the curated,
              authority-tagged knowledge base and re-ranked by source authority — primary regulation and
              statute outrank secondary summaries.
            </p>

            {/* Search bar */}
            <form
             onSubmit={(e) => {
              e.preventDefault();
              run(query);
              }}
             className="mt-10 flex gap-2"
            >
             <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. What is the Antideficiency Act violation process?"
              className="flex-1 bg-navy-900 border border-navy-700 rounded-lg px-4 py-3 text-navy-50 placeholder:text-navy-500 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
             />
             <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 bg-accent-500 hover:bg-accent-600 disabled:opacity-50 text-navy-950 font-semibold rounded-lg transition-all"
             >
              {loading ? 'Searching…' : 'Search'}
             </button>
            </form>

            {/* Suggestions */}
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setQuery(s);
                    run(s);
                    }}
                  className="px-3 py-1.5 text-xs text-navy-300 bg-navy-800/60 hover:bg-navy-700 rounded-full transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="py-14 px-4 sm:px-6 lg:px-8">
         <div className="max-w-4xl mx-auto">
          {error && (
            <div className="glass-card rounded-xl p-4 border-red-500/30 text-red-300 text-sm mb-6">{error}</div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent-500"></div>
            </div>
          )}

          {!loading && resp && !error && (
             <>
              {/* Top answer */}
              {resp.answer ? (
                <div className="glass-card rounded-xl p-6 mb-8 border-accent-500/30">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-accent-400 text-sm font-semibold uppercase tracking-wide">Best match</span>
                    <span className="text-xs text-navy-400">· {resp.matched} matches in {resp.corpus.doc_count}-chunk corpus</span>
                  </div>
                  <h2 className="text-xl font-bold text-navy-50 mb-2">{resp.answer.page}</h2>
                  <p className="text-navy-200 text-sm leading-relaxed">{resp.answer.text}</p>
                  {resp.answer.source && (
                    <div className="mt-3 text-xs text-navy-400">
                      Source: <span className="font-mono text-accent-300">{resp.answer.source}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="glass-card rounded-xl p-6 mb-8 text-navy-300">
                  No matching knowledge found for &ldquo;{resp.query}&rdquo;. Try a different term.
                </div>
              )}

              {/* Supporting sources */}
              {resp.results.length > 1 && (
                <div>
                  <h3 className="text-lg font-semibold text-navy-50 mb-4">Supporting sources</h3>
                  <div className="space-y-3">
                    {resp.results.slice(1).map((r, i) => {
                      const auth = authorityLabel(r.authority);
                      return (
                        <div key={i} className="glass-card rounded-lg p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-navy-100 font-medium text-sm">{r.page}</div>
                              <div className="text-xs text-navy-500 mt-0.5 truncate max-w-md">{r.section}</div>
                            </div>
                            <span className={`shrink-0 text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${auth.cls}`}>
                              {auth.label}
                            </span>
                          </div>
                          <p className="text-navy-300 text-xs leading-relaxed mt-2 line-clamp-3">{r.text}</p>
                          {r.source && (
                            <div className="text-[10px] text-navy-500 mt-2 font-mono">📄 {r.source}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
             </>
          )}

          {!loading && !resp && !error && (
            <div className="text-center py-16 text-navy-400">
              <p className="text-sm">Ask a question or pick a suggestion to begin.</p>
            </div>
          )}
         </div>
        </section>

        <Footer />
      </main>
    );
}
