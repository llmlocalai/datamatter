'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

interface BudgetFunction {
  function: string;
  amount: number;
  percentage: number;
}

interface AgencyData {
  name: string;
  amount: number;
}

interface FiscalYearData {
  year: number;
  obligations: number;
}

export default function BudgetAnalysisPage() {
  const [budgetFunctions, setBudgetFunctions] = useState<BudgetFunction[]>([]);
  const [agencies, setAgencies] = useState<AgencyData[]>([]);
  const [fiscalYears, setFiscalYears] = useState<FiscalYearData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [functionsRes, agenciesRes, fyRes] = await Promise.all([
          fetch('/api/budget?type=functions'),
          fetch('/api/budget?type=agencies'),
          fetch('/api/budget?type=fiscal-year'),
        ]);

        if (functionsRes.ok) setBudgetFunctions(await functionsRes.json());
        if (agenciesRes.ok) setAgencies(await agenciesRes.json());
        if (fyRes.ok) setFiscalYears(await fyRes.json());
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

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

  return (
    <main className="min-h-screen bg-navy-950">
      <Navbar />

      {/* Hero Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-b border-navy-800">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-navy-50 mb-6">
            DoD Budget Analysis Dashboard
          </h1>
          <p className="text-lg text-navy-300 max-w-3xl mx-auto">
            Enterprise-grade budget analysis for senior budget analysts. Leverage USASpending data,
            PPBE compliance metrics, and congressional oversight tracking.
          </p>
        </div>
      </section>

      {/* Budget Functions */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-navy-50 mb-8">Budget Functions</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {budgetFunctions.map((func) => (
              <div
                key={func.function}
                className="glass-card rounded-xl p-6 hover:border-accent-500/40 transition-all"
              >
                <div className="text-sm text-accent-400 font-semibold mb-2">
                  {func.function}
                </div>
                <div className="text-2xl font-bold text-navy-50 mb-2">
                  ${func.amount / 1000000000}B
                </div>
                <div className="w-full bg-navy-800 rounded-full h-2">
                  <div
                    className="bg-accent-500 h-2 rounded-full"
                    style={{ width: `${func.percentage}%` }}
                  />
                </div>
                <div className="text-xs text-navy-400 mt-2">{func.percentage}%</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Agencies */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-navy-50 mb-8">Top Funding Agencies</h2>

          <div className="overflow-x-auto">
            <table className="min-w-full glass-card rounded-xl overflow-hidden">
              <thead>
                <tr className="bg-navy-800/50">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-accent-400 uppercase">
                    Agency
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-accent-400 uppercase">
                    Amount (Billions)
                  </th>
                </tr>
              </thead>
              <tbody>
                {agencies.map((agency) => (
                  <tr key={agency.name} className="border-t border-navy-800">
                    <td className="px-6 py-3 text-navy-200 font-medium">{agency.name}</td>
                    <td className="px-6 py-3 text-right text-navy-50 font-bold">
                      ${agency.amount / 1000000000}B
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}