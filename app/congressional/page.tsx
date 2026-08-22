'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

interface OversightRequest {
  quarter: string;
  requests: number;
  responses: number;
}

interface Testimony {
  committee: string;
  date: string;
  witnesses: number;
}

export default function CongressionalOversightPage() {
  const [congressionalData, setCongressionalData] = useState<{
    oversight_requests: OversightRequest[];
    testimony_scheduled: Testimony[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/congressional')
      .then((res) => res.json())
      .then((data) => {
        setCongressionalData(data);
        setLoading(false);
      })
      .catch((error) => {
        console.error('Error fetching congressional data:', error);
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

  if (!congressionalData) {
    return (
      <main className="min-h-screen bg-navy-950">
        <Navbar />
        <div className="flex items-center justify-center min-h-screen">
          <p className="text-navy-300">Failed to load congressional oversight data</p>
        </div>
        <Footer />
      </main>
    );
  }

  // Calculate totals
  const totalRequests = congressionalData.oversight_requests.reduce(
    (sum, quarter) => sum + quarter.requests,
    0
  );
  const totalResponses = congressionalData.oversight_requests.reduce(
    (sum, quarter) => sum + quarter.responses,
    0
  );
  const responseRate = totalRequests > 0 ? (totalResponses / totalRequests) * 100 : 0;

  return (
    <main className="min-h-screen bg-navy-950">
      <Navbar />

      {/* Hero Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-b border-navy-800">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-navy-50 mb-6">
            Congressional Oversight Dashboard
          </h1>
          <p className="text-lg text-navy-300 max-w-3xl mx-auto">
            Track congressional requests, testimony schedules, and response rates for
            senior budget analyst coordination with services and defense-wide stakeholders.
          </p>
        </div>
      </section>

      {/* Response Metrics */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="glass-card rounded-xl p-6 text-center">
              <div className="text-sm text-accent-400 font-semibold mb-2">
                Total Requests
              </div>
              <div className="text-4xl font-bold text-navy-50 mb-2">
                {totalRequests}
              </div>
            </div>
            <div className="glass-card rounded-xl p-6 text-center">
              <div className="text-sm text-accent-400 font-semibold mb-2">
                Total Responses
              </div>
              <div className="text-4xl font-bold text-navy-50 mb-2">
                {totalResponses}
              </div>
            </div>
            <div className="glass-card rounded-xl p-6 text-center border-accent-500/20">
              <div className="text-sm text-accent-400 font-semibold mb-2">
                Response Rate
              </div>
              <div className="text-4xl font-bold text-accent-400 mb-2">
                {responseRate.toFixed(1)}%
              </div>
              <div className="w-full bg-navy-800 rounded-full h-2">
                <div
                  className="bg-accent-500 h-2 rounded-full"
                  style={{ width: `${responseRate}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Oversight Requests by Quarter */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-navy-50 mb-8">
            Oversight Requests by Quarter
          </h2>

          <div className="glass-card rounded-xl p-6">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-navy-800/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-accent-400 uppercase">
                      Quarter
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-accent-400 uppercase">
                      Requests
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-accent-400 uppercase">
                      Responses
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-accent-400 uppercase">
                      Rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {congressionalData.oversight_requests.map((quarter) => (
                    <tr key={quarter.quarter} className="border-t border-navy-800">
                      <td className="px-4 py-3 text-navy-200">{quarter.quarter}</td>
                      <td className="px-4 py-3 text-center text-navy-50">
                        {quarter.requests}
                      </td>
                      <td className="px-4 py-3 text-center text-navy-50">
                        {quarter.responses}
                      </td>
                      <td className="px-4 py-3 text-center text-accent-400 font-bold">
                        {quarter.requests > 0
                          ? ((quarter.responses / quarter.requests) * 100).toFixed(1) + '%'
                          : '0%'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Upcoming Testimonies */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-navy-50 mb-8">Upcoming Testimonies</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {congressionalData.testimony_scheduled.map((testimony, index) => (
              <div
                key={index}
                className="glass-card rounded-xl p-6 hover:border-accent-500/40 transition-all"
              >
                <div className="text-sm text-accent-400 font-semibold mb-2">
                  {testimony.committee}
                </div>
                <div className="text-navy-200 mb-4">{testimony.date}</div>
                <div className="text-xs text-navy-400">
                  {testimony.witnesses} witness(es) scheduled
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