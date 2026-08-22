'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

interface Row {
  name?: string;
  state?: string;
  code?: string;
  description?: string;
  type?: string;
  reason?: string;
  label?: string;
  obligation: number;
}

interface ContractingData {
  fiscal_year: number;
  total_obligation: number;
  award_count: number;
  simplified_commercial_awards: number;
  by_sub_agency: Row[];
  top_recipients: Row[];
  by_recipient_state: Row[];
  by_performance_state: Row[];
  top_naics: Row[];
  by_set_aside: Row[];
  by_competition_exception: Row[];
  by_extent_competed: Row[];
  by_contract_pricing: Row[];
  available_fiscal_years: number[];
  source: string;
  vintage: string;
  derived: {
     sole_source_obligation: number;
     sole_source_pct: number;
     no_set_aside_obligation: number;
     no_set_aside_pct: number;
   };
}

const fmtB = (n: number) => `$${(n / 1e9).toFixed(2)}B`;
const fmtK = (n: number) => `${(n / 1e3).toFixed(1)}K`;
const pct = (v: number, t: number) => (t ? ((v / t) * 100).toFixed(1) : '0') + '%';

export default function ContractingIntelligencePage() {
  const [data, setData] = useState<ContractingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fy, setFy] = useState<string>('');

  useEffect(() => {
    const url = fy ? `/api/contracting?fiscal-year=${fy}` : '/api/contracting';
    setLoading(true);
    fetch(url)
       .then((r) => r.json())
       .then((d) => setData(d))
       .catch((e) => console.error(e))
       .finally(() => setLoading(false));
   }, [fy]);

  if (loading) {
    return (
       <main className="min-h-screen bg-navy-950">
        <Navbar />
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-500"></div>
        </div>
        <Footer />
       </main>
    );
   }

  if (!data) {
    return (
       <main className="min-h-screen bg-navy-950">
        <Navbar />
        <div className="flex items-center justify-center min-h-screen text-navy-300">
          Failed to load contracting intelligence.
        </div>
        <Footer />
       </main>
    );
   }

  const total = data.total_obligation;
  const maxSub = data.by_sub_agency[0]?.obligation || 1;

  return (
     <main className="min-h-screen bg-navy-950">
       <Navbar />

       {/* Hero */}
       <section className="py-20 px-4 sm:px-6 lg:px-8 border-b border-navy-800 grid-pattern">
        <div className="max-w-6xl mx-auto text-center">
          <div className="inline-block text-xs font-semibold text-accent-400 uppercase tracking-widest mb-4">
            Live USASpending · Agency 097 (DoD) · Vintage {data.vintage}
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-navy-50 mb-6">
            Contracting & Procurement <span className="gradient-text">Intelligence</span>
          </h1>
          <p className="text-lg text-navy-300 max-w-3xl mx-auto">
            Pre-aggregated obligations across {fmtK(data.award_count)} contract actions, streamed from
            the full USASpending DoD warehouse. This is real award data — not a demo stub.
          </p>

          {/* Fiscal year selector */}
          <div className="mt-8 flex items-center justify-center gap-2 flex-wrap">
            {data.available_fiscal_years
              .slice()
              .reverse()
              .map((y) => (
                <button
                  key={y}
                  onClick={() => setFy(String(y))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    String(y) === String(data.fiscal_year)
                      ? 'bg-accent-500 text-navy-950'
                      : 'bg-navy-800 text-navy-300 hover:bg-navy-700'
                  }`}
                >
                  FY{y}
                </button>
              ))}
          </div>
        </div>
       </section>

       {/* KPI cards */}
       <section className="py-14 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="glass-card rounded-xl p-6 text-center">
            <div className="text-sm text-accent-400 font-semibold mb-2">FY{data.fiscal_year} Total Obligated</div>
            <div className="text-3xl font-bold text-navy-50">{fmtB(total)}</div>
          </div>
          <div className="glass-card rounded-xl p-6 text-center">
            <div className="text-sm text-accent-400 font-semibold mb-2">Contract Actions</div>
            <div className="text-3xl font-bold text-navy-50">{fmtK(data.award_count)}</div>
          </div>
          <div className="glass-card rounded-xl p-6 text-center border-amber-500/20">
            <div className="text-sm text-amber-400 font-semibold mb-2">Sole-Source / Non-Competed</div>
            <div className="text-3xl font-bold text-amber-300">{data.derived.sole_source_pct}%</div>
            <div className="text-xs text-navy-400 mt-1">{fmtB(data.derived.sole_source_obligation)}</div>
          </div>
          <div className="glass-card rounded-xl p-6 text-center">
            <div className="text-sm text-accent-400 font-semibold mb-2">Full & Open / No Set-Aside</div>
            <div className="text-3xl font-bold text-navy-50">{data.derived.no_set_aside_pct}%</div>
            <div className="text-xs text-navy-400 mt-1">{fmtB(data.derived.no_set_aside_obligation)}</div>
          </div>
        </div>
       </section>

       {/* Sub-agency allocation */}
       <section className="py-14 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-navy-50 mb-2">Obligation by Awarding Component</h2>
          <p className="text-sm text-navy-400 mb-8">
            Where FY{data.fiscal_year} dollars land across DoD components.
          </p>
          <div className="space-y-4">
            {data.by_sub_agency.slice(0, 10).map((s) => (
              <div key={s.name} className="glass-card rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-navy-100 font-medium text-sm">{s.name}</span>
                  <span className="text-navy-50 font-bold text-sm">{fmtB(s.obligation)}</span>
                </div>
                <div className="w-full bg-navy-800 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-accent-400 to-accent-600 h-2 rounded-full"
                    style={{ width: `${(s.obligation / maxSub) * 100}%` }}
                  />
                </div>
                <div className="text-xs text-navy-400 mt-1.5">{pct(s.obligation, total)} of FY total</div>
              </div>
            ))}
          </div>
        </div>
       </section>

       {/* Top prime contractors */}
       <section className="py-14 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-navy-50 mb-8">Top Prime Contractors</h2>
          <div className="overflow-x-auto glass-card rounded-xl">
            <table className="min-w-full">
              <thead>
                <tr className="bg-navy-800/50">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-accent-400 uppercase">#</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-accent-400 uppercase">Recipient</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-accent-400 uppercase">Obligated</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-accent-400 uppercase">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.top_recipients.slice(0, 15).map((r, i) => (
                  <tr key={r.name} className="border-t border-navy-800">
                    <td className="px-6 py-3 text-navy-500 text-sm">{i + 1}</td>
                    <td className="px-6 py-3 text-navy-100 font-medium text-sm">{r.name}</td>
                    <td className="px-6 py-3 text-right text-navy-50 font-bold text-sm">{fmtB(r.obligation)}</td>
                    <td className="px-6 py-3 text-right text-navy-300 text-sm">{pct(r.obligation, total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
       </section>

       {/* Competition exceptions + set-asides */}
       <section className="py-14 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h2 className="text-xl font-bold text-navy-50 mb-2">Other Than Full & Open Competition</h2>
            <p className="text-sm text-navy-400 mb-6">FAR 6.302 authority justifications for non-competed dollars.</p>
            <div className="space-y-3">
              {data.by_competition_exception.filter((c) => c.reason).slice(0, 9).map((c) => (
                <div key={c.reason} className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="w-full bg-navy-800 rounded-full h-1.5">
                      <div
                        className="bg-amber-500/70 h-1.5 rounded-full"
                        style={{ width: `${(c.obligation / (data.by_competition_exception[0]?.obligation || 1)) * 100}%` }}
                      />
                    </div>
                    <div className="text-xs text-navy-300 mt-1">{c.reason}</div>
                  </div>
                  <div className="text-sm font-bold text-navy-100 w-20 text-right">{fmtB(c.obligation)}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-xl font-bold text-navy-50 mb-2">Small-Business & Set-Aside</h2>
            <p className="text-sm text-navy-400 mb-6">8(a), SDVOSB, WOSB, HUBZone participation in obligated dollars.</p>
            <div className="space-y-3">
              {data.by_set_aside.filter((s) => s.type && s.type !== 'NO SET ASIDE USED.').slice(0, 9).map((s) => (
                <div key={s.type} className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="w-full bg-navy-800 rounded-full h-1.5">
                      <div
                        className="bg-accent-500 h-1.5 rounded-full"
                        style={{ width: `${(s.obligation / (data.by_set_aside[0]?.obligation || 1)) * 100}%` }}
                      />
                    </div>
                    <div className="text-xs text-navy-300 mt-1">{s.type}</div>
                  </div>
                  <div className="text-sm font-bold text-navy-100 w-20 text-right">{fmtB(s.obligation)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
       </section>

       {/* NAICS + state */}
       <section className="py-14 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h2 className="text-xl font-bold text-navy-50 mb-6">Top NAICS Sectors</h2>
            <div className="overflow-x-auto glass-card rounded-xl">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-navy-800/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-accent-400 uppercase">Code</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-accent-400 uppercase">Description</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-accent-400 uppercase">Obligated</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_naics.slice(0, 10).map((n) => (
                    <tr key={n.code} className="border-t border-navy-800">
                      <td className="px-4 py-3 text-navy-400 text-sm font-mono">{n.code}</td>
                      <td className="px-4 py-3 text-navy-200 text-sm">{n.description || '—'}</td>
                      <td className="px-4 py-3 text-right text-navy-50 font-bold text-sm">{fmtB(n.obligation)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h2 className="text-xl font-bold text-navy-50 mb-6">Top Awardee States</h2>
            <div className="overflow-x-auto glass-card rounded-xl">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-navy-800/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-accent-400 uppercase">State</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-accent-400 uppercase">Obligated</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-accent-400 uppercase">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_recipient_state.slice(0, 10).map((s) => (
                    <tr key={s.state} className="border-t border-navy-800">
                      <td className="px-4 py-3 text-navy-200 text-sm font-mono">{s.state}</td>
                      <td className="px-4 py-3 text-right text-navy-50 font-bold text-sm">{fmtB(s.obligation)}</td>
                      <td className="px-4 py-3 text-right text-navy-400 text-sm">{pct(s.obligation, total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
       </section>

       <Footer />
     </main>
   );
}
