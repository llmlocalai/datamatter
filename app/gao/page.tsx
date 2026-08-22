'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

interface YearlyFindings {
  year: number;
  findings: number;
  material_weaknesses: number;
}

interface FindingType {
  type: string;
  count: number;
}

export default function GAOTroublePage() {
  const [gaoData, setGaoData] = useState<{
    findings_by_year: YearlyFindings[];
    finding_types: FindingType[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/gao')
      .then((res) => res.json())
      .then((data) => {
        setGaoData(data);
        setLoading(false);
      })
      .catch((error) => {
        console.error('Error fetching GAO data:', error);
        setLoading(false);
      });
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

  if (!gaoData) {
    return (
      <main className="min-h-screen bg-navy-950">
        <Navbar />
        <div className="flex items-center justify-center min-h-screen">
          <p className="text-navy-300">Failed to load GAO audit data</p>
        </div>
        <Footer />
      </main>
    );
  }

  // Calculate totals
  const totalFindings = gaoData.findings_by_year.reduce(
    (sum, year) => sum + year.findings,
    0
  );
  const totalMaterialWeaknesses = gaoData.findings_by_year.reduce(
    (sum, year) => sum + year.material_weaknesses,
    0
  );

  return (
    <main className="min-h-screen bg-navy-950">
      <Navbar />

      {/* Hero Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-b border-navy-800">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-navy-50 mb-6">
            GAO Audit Findings Dashboard
          </h1>
          <p className="text-lg text-navy-300 max-w-3xl mx-auto">
            Track Government Accountability Office findings and material weaknesses
            across DoD financial statements and budget execution.
          </p>
        </div>
      </section>

      {/* Key Metrics */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="glass-card rounded-xl p-6 text-center">
              <div className="text-sm text-accent-400 font-semibold mb-2">
                Total Findings
              </div>
              <div className="text-4xl font-bold text-navy-50 mb-2">
                {totalFindings}
              </div>
            </div>
            <div className="glass-card rounded-xl p-6 text-center border-red-500/20">
              <div className="text-sm text-accent-400 font-semibold mb-2">
                Material Weaknesses
              </div>
              <div className="text-4xl font-bold text-red-400 mb-2">
                {totalMaterialWeaknesses}
              </div>
            </div>
            <div className="glass-card rounded-xl p-6 text-center">
              <div className="text-sm text-accent-400 font-semibold mb-2">
                Finding Types
              </div>
              <div className="text-4xl font-bold text-navy-50 mb-2">
                {gaoData.finding_types.length}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Findings Over Time */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-navy-50 mb-8">Findings Over Time</h2>

          <div className="glass-card rounded-xl p-6">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-navy-800/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-accent-400 uppercase">
                      Year
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-accent-400 uppercase">
                      Total Findings
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-accent-400 uppercase">
                      Material Weaknesses
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {gaoData.findings_by_year.map((year) => (
                    <tr key={year.year} className="border-t border-navy-800">
                      <td className="px-4 py-3 text-navy-200">{year.year}</td>
                      <td className="px-4 py-3 text-center text-navy-50">
                        {year.findings}
                      </td>
                      <td className="px-4 py-3 text-center text-red-400 font-bold">
                        {year.material_weaknesses}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Finding Types */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-navy-50 mb-8">Finding Types Distribution</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {gaoData.finding_types.map((finding) => (
              <div
                key={finding.type}
                className="glass-card rounded-xl p-6 hover:border-accent-500/40 transition-all"
              >
                <div className="text-sm text-accent-400 font-semibold mb-2">
                  {finding.type}
                </div>
                <div className="text-2xl font-bold text-navy-50 mb-2">
                  {finding.count}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}