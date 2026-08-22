'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

interface PPBECompliance {
  total_programs: number;
  compliant_programs: number;
  non_compliant_programs: number;
  compliance_rate: number;
}

interface OMB30Compliance {
  submitted: number;
  approved: number;
  pending: number;
  rejected: number;
}

interface JustificationQuality {
  high_quality: number;
  medium_quality: number;
  low_quality: number;
}

export default function PPBECompliancePage() {
  const [ppbeData, setPpbeData] = useState<{
    ppbe_compliance: PPBECompliance;
    omg30_compliance: OMB30Compliance;
    justification_quality: JustificationQuality;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/ppbe')
      .then((res) => res.json())
      .then((data) => {
        setPpbeData(data);
        setLoading(false);
      })
      .catch((error) => {
        console.error('Error fetching PPBE data:', error);
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

  if (!ppbeData) {
    return (
      <main className="min-h-screen bg-navy-950">
        <Navbar />
        <div className="flex items-center justify-center min-h-screen">
          <p className="text-navy-300">Failed to load PPBE data</p>
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
            PPBE Compliance Dashboard
          </h1>
          <p className="text-lg text-navy-300 max-w-3xl mx-auto">
            Track program compliance with Planning, Programming, and Budgeting System requirements
            across the Department of Defense.
          </p>
        </div>
      </section>

      {/* Compliance Overview */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Overall Compliance */}
            <div className="glass-card rounded-xl p-6">
              <div className="text-sm text-accent-400 font-semibold mb-2">
                Overall Compliance Rate
              </div>
              <div className="text-3xl font-bold text-navy-50 mb-2">
                {ppbeData.ppbe_compliance.compliance_rate}%
              </div>
              <div className="text-sm text-navy-400">
                {ppbeData.ppbe_compliance.compliant_programs.toLocaleString()} of{' '}
                {ppbeData.ppbe_compliance.total_programs.toLocaleString()} programs
              </div>
              <div className="mt-4 w-full bg-navy-800 rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full"
                  style={{ width: `${ppbeData.ppbe_compliance.compliance_rate}%` }}
                />
              </div>
            </div>

            {/* Non-Compliant Programs */}
            <div className="glass-card rounded-xl p-6">
              <div className="text-sm text-accent-400 font-semibold mb-2">
                Non-Compliant Programs
              </div>
              <div className="text-3xl font-bold text-red-400 mb-2">
                {ppbeData.ppbe_compliance.non_compliant_programs}
              </div>
              <div className="text-sm text-navy-400">
                Requires immediate attention
              </div>
            </div>

            {/* Total Programs */}
            <div className="glass-card rounded-xl p-6">
              <div className="text-sm text-accent-400 font-semibold mb-2">
                Total Programs Tracked
              </div>
              <div className="text-3xl font-bold text-navy-50 mb-2">
                {ppbeData.ppbe_compliance.total_programs.toLocaleString()}
              </div>
              <div className="text-sm text-navy-400">
                Across all DoD components
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* OMB 30 Compliance */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-navy-50 mb-8">OMB Circular A-30 Compliance</h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="glass-card rounded-xl p-6 text-center">
              <div className="text-sm text-accent-400 mb-2">Submitted</div>
              <div className="text-2xl font-bold text-navy-50">
                {ppbeData.omg30_compliance.submitted}
              </div>
            </div>
            <div className="glass-card rounded-xl p-6 text-center">
              <div className="text-sm text-accent-400 mb-2">Approved</div>
              <div className="text-2xl font-bold text-green-400">
                {ppbeData.omg30_compliance.approved}
              </div>
            </div>
            <div className="glass-card rounded-xl p-6 text-center">
              <div className="text-sm text-accent-400 mb-2">Pending</div>
              <div className="text-2xl font-bold text-yellow-400">
                {ppbeData.omg30_compliance.pending}
              </div>
            </div>
            <div className="glass-card rounded-xl p-6 text-center">
              <div className="text-sm text-accent-400 mb-2">Rejected</div>
              <div className="text-2xl font-bold text-red-400">
                {ppbeData.omg30_compliance.rejected}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Justification Quality */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-navy-50 mb-8">Budget Justification Quality</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="glass-card rounded-xl p-6 text-center border-green-500/20">
              <div className="text-sm text-green-400 font-semibold mb-2">High Quality</div>
              <div className="text-3xl font-bold text-green-400 mb-2">
                {ppbeData.justification_quality.high_quality}
              </div>
              <div className="text-sm text-navy-400">
                Clear, data-driven justifications
              </div>
            </div>
            <div className="glass-card rounded-xl p-6 text-center border-yellow-500/20">
              <div className="text-sm text-yellow-400 font-semibold mb-2">Medium Quality</div>
              <div className="text-3xl font-bold text-yellow-400 mb-2">
                {ppbeData.justification_quality.medium_quality}
              </div>
              <div className="text-sm text-navy-400">
                Needs improvement
              </div>
            </div>
            <div className="glass-card rounded-xl p-6 text-center border-red-500/20">
              <div className="text-sm text-red-400 font-semibold mb-2">Low Quality</div>
              <div className="text-3xl font-bold text-red-400 mb-2">
                {ppbeData.justification_quality.low_quality}
              </div>
              <div className="text-sm text-navy-400">
                Requires revision
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}