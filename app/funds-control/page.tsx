'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

interface Trend {
  fiscal_year: number;
  total_budgetary_resources: number;
  obligations_incurred: number;
  unobligated_balance: number;
  obligation_rate_pct: number;
}

interface FundsData {
  fiscal_year: number;
  total_budgetary_resources: number;
  obligations_incurred: number;
  unobligated_balance: number;
  gross_outlays: number;
  obligation_rate_pct: number;
  outlay_rate_pct: number;
  unobligated_pct_of_budget: number;
  top_tas_accounts: { tas: string; agency: string; obligation: number }[];
  top_agencies: { agency: string; obligation: number }[];
  by_budget_function: { function: string; obligation: number }[];
  trend: Trend[];
  available_fiscal_years: number[];
  source: string;
  granularity: string;
  lapse_risk_flag: boolean;
}

const fmtB = (n: number) => `$${(n / 1e9).toFixed(1)}B`;
const fmtT = (n: number) => (n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : `$${(n / 1e9).toFixed(1)}B`);

function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const w = 600, h = 140, pad = 10;
  const max = Math.max(...points), min = Math.min(...points);
  const span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = pad + i * step;
    const y = h - pad - ((p - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `${pad},${h - pad} ${coords.join(' ')} ${w - pad},${h - pad}`;
  return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40" preserveAspectRatio="none">
        <polygon points={area} fill={color} opacity={0.12} />
        <polyline points={coords.join(' ')} fill="none" stroke={color} strokeWidth={2.5} />
        {coords.map((c, i) => {
          const [x, y] = c.split(',').map(Number);
          return <circle key={i} cx={x} cy={y} r={3.5} fill={color} />;
         })}
      </svg>
    );
}

export default function FundsControlPage() {
  const [data, setData] = useState<FundsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fy, setFy] = useState<string>('');

  useEffect(() => {
    const url = fy ? `/api/funds-control?fiscal-year=${fy}` : '/api/funds-control';
    setLoading(true);
    fetch(url).then((r) => r.json()).then(setData).catch(console.error).finally(() => setLoading(false));
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
         <div className="flex items-center justify-center min-h-screen text-navy-300">Failed to load funds-control data.</div>
         <Footer />
        </main>
     );
    }

  const trend = data.trend;
  const maxTas = data.top_tas_accounts[0]?.obligation || 1;
  const total = data.total_budgetary_resources;

  return (
      <main className="min-h-screen bg-navy-950">
        <Navbar />

        <section className="py-20 px-4 sm:px-6 lg:px-8 border-b border-navy-800 grid-pattern">
         <div className="max-w-6xl mx-auto text-center">
           <div className="inline-block text-xs font-semibold text-accent-400 uppercase tracking-widest mb-4">
            Statement of Budgetary Resources · TAS-level · {data.source}
           </div>
           <h1 className="text-4xl sm:text-5xl font-bold text-navy-50 mb-6">
            Budget Execution & <span className="gradient-text">Funds Control</span>
           </h1>
           <p className="text-lg text-navy-300 max-w-3xl mx-auto">
            Real-time obligation rates, unobligated balances, and lapse-risk exposure across DoD
            Treasury accounts — the data that guards against antideficiency violations.
           </p>
           <div className="mt-8 flex items-center justify-center gap-2 flex-wrap">
             {data.available_fiscal_years.slice().reverse().map((y) => (
               <button
                key={y}
                onClick={() => setFy(String(y))}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  String(y) === String(data.fiscal_year) ? 'bg-accent-500 text-navy-950' : 'bg-navy-800 text-navy-300 hover:bg-navy-700'
                }`}
               >
                FY{y}
               </button>
             ))}
           </div>
         </div>
        </section>

        {/* KPIs */}
        <section className="py-14 px-4 sm:px-6 lg:px-8">
         <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
           <div className="glass-card rounded-xl p-6 text-center">
             <div className="text-sm text-accent-400 font-semibold mb-2">Total Budgetary Resources</div>
             <div className="text-3xl font-bold text-navy-50">{fmtT(total)}</div>
           </div>
           <div className="glass-card rounded-xl p-6 text-center">
             <div className="text-sm text-accent-400 font-semibold mb-2">Obligation Rate</div>
             <div className="text-3xl font-bold text-navy-50">{data.obligation_rate_pct}%</div>
             <div className="text-xs text-navy-400 mt-1">{fmtT(data.obligations_incurred)} obligated</div>
           </div>
           <div className={`glass-card rounded-xl p-6 text-center ${data.lapse_risk_flag ? 'border-amber-500/40' : ''}`}>
             <div className={`text-sm font-semibold mb-2 ${data.lapse_risk_flag ? 'text-amber-400' : 'text-accent-400'}`}>
               Unobligated (Lapse Exposure)
             </div>
             <div className={`text-3xl font-bold ${data.lapse_risk_flag ? 'text-amber-300' : 'text-navy-50'}`}>
               {fmtT(data.unobligated_balance)}
             </div>
             <div className="text-xs text-navy-400 mt-1">{data.unobligated_pct_of_budget}% of budget</div>
           </div>
           <div className="glass-card rounded-xl p-6 text-center">
             <div className="text-sm text-accent-400 font-semibold mb-2">Outlay Rate</div>
             <div className="text-3xl font-bold text-navy-50">{data.outlay_rate_pct}%</div>
             <div className="text-xs text-navy-400 mt-1">{fmtT(data.gross_outlays)} outlaid</div>
           </div>
         </div>

         {data.lapse_risk_flag && (
           <div className="max-w-6xl mx-auto mt-6">
             <div className="glass-card rounded-xl p-4 border-amber-500/30 flex items-center gap-3">
               <span className="text-amber-400 text-2xl">⚠</span>
               <div>
                 <div className="text-amber-200 font-semibold text-sm">Elevated lapse / antideficiency exposure</div>
                 <div className="text-navy-400 text-xs">
                   FY{data.fiscal_year} unobligated balance ({fmtT(data.unobligated_balance)}) exceeds 25% of total
                   budgetary resources — typical for a mid-year view, but flagged for funds-control monitoring.
                 </div>
               </div>
             </div>
           </div>
         )}
        </section>

        {/* Trend */}
        <section className="py-14 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
         <div className="max-w-6xl mx-auto">
           <h2 className="text-2xl font-bold text-navy-50 mb-2">FY-over-FY Execution Trend</h2>
           <p className="text-sm text-navy-400 mb-6">Obligation rate and unobligated balance, all fiscal years on record.</p>
           <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
             <div className="glass-card rounded-xl p-6">
               <div className="text-sm text-accent-400 font-semibold mb-3">Obligation Rate (%)</div>
               <Sparkline points={trend.map((t) => t.obligation_rate_pct)} color="#38bdf8" />
               <div className="flex justify-between text-xs text-navy-400 mt-2">
                 {trend.map((t) => <span key={t.fiscal_year}>FY{String(t.fiscal_year).slice(2)}</span>)}
               </div>
             </div>
             <div className="glass-card rounded-xl p-6">
               <div className="text-sm text-amber-400 font-semibold mb-3">Unobligated Balance ($B)</div>
               <Sparkline points={trend.map((t) => t.unobligated_balance / 1e9)} color="#fbbf24" />
               <div className="flex justify-between text-xs text-navy-400 mt-2">
                 {trend.map((t) => <span key={t.fiscal_year}>FY{String(t.fiscal_year).slice(2)}</span>)}
               </div>
             </div>
           </div>
         </div>
        </section>

        {/* Top TAS + agencies */}
        <section className="py-14 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
         <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10">
           <div>
             <h2 className="text-xl font-bold text-navy-50 mb-6">Top Obligating Treasury Accounts</h2>
             <div className="space-y-3">
               {data.top_tas_accounts.slice(0, 10).map((t) => (
                 <div key={t.tas} className="glass-card rounded-lg p-3">
                   <div className="flex items-center justify-between mb-1.5">
                     <span className="text-navy-100 font-medium text-sm truncate pr-3">{t.agency || t.tas}</span>
                     <span className="text-navy-50 font-bold text-sm">{fmtT(t.obligation)}</span>
                   </div>
                   <div className="w-full bg-navy-800 rounded-full h-1.5">
                     <div className="bg-gradient-to-r from-accent-400 to-accent-600 h-1.5 rounded-full" style={{ width: `${(t.obligation / maxTas) * 100}%` }} />
                   </div>
                   <div className="text-xs text-navy-500 mt-1 font-mono truncate">{t.tas}</div>
                 </div>
               ))}
             </div>
           </div>
           <div>
             <h2 className="text-xl font-bold text-navy-50 mb-6">Obligation by Agency</h2>
             <div className="overflow-x-auto glass-card rounded-xl">
               <table className="min-w-full">
                 <thead>
                   <tr className="bg-navy-800/50">
                     <th className="px-4 py-3 text-left text-xs font-semibold text-accent-400 uppercase">Agency</th>
                     <th className="px-4 py-3 text-right text-xs font-semibold text-accent-400 uppercase">Obligated</th>
                   </tr>
                 </thead>
                 <tbody>
                   {data.top_agencies.map((a) => (
                     <tr key={a.agency} className="border-t border-navy-800">
                       <td className="px-4 py-3 text-navy-200 text-sm">{a.agency}</td>
                       <td className="px-4 py-3 text-right text-navy-50 font-bold text-sm">{fmtT(a.obligation)}</td>
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
