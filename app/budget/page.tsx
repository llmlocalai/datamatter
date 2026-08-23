"use client";

import { useState, useEffect, useMemo } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import DetailTable from "@/components/budget/DetailTable";
import DocumentPanel from "@/components/budget/DocumentPanel";
import {
  TrendBars,
  Donut,
  BarList,
  MiniSpark,
  fmtT,
  fmtPct,
  colorAt,
} from "@/components/budget/Charts";
import type { Overview, ExhibitSummary, ExhibitCode } from "@/lib/fy27-data";

// A compact KPI card.
function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "amber" | "default";
}) {
  return (
      <div className="glass-card rounded-xl p-6 text-center">
        <div
          className={`text-sm font-semibold mb-2 ${
            accent === "amber" ? "text-amber-400" : "text-accent-400"
          }`}
        >
          {label}
        </div>
        <div className="text-3xl font-bold text-navy-50 tabular-nums">{value}</div>
        {sub && <div className="text-xs text-navy-400 mt-1.5">{sub}</div>}
      </div>
    );
}

export default function BudgetDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ExhibitCode>("o1"); // O&M is the largest

  useEffect(() => {
    fetch("/api/budget-fy27")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
       })
      .then((json: Overview) => {
        setData(json);
        if (json.exhibits?.length) setActive(json.exhibits[0].code);
        })
      .catch((e) => setError(e?.message || "Failed to load"))
      .finally(() => setLoading(false));
   }, []);

    // Resolved BEFORE the early returns so the hook count is stable across
    // renders (Rules of Hooks). Null-safe: `data` is null until the fetch lands.
  const activeExhibit = useMemo<ExhibitSummary | undefined>(
      () => (data?.exhibits ?? []).find((e) => e.code === active),
      [data, active]
    );

  if (loading) {
    return (
       <main className="min-h-screen bg-navy-950">
        <Navbar />
        <div className="flex items-center justify-center min-h-[70vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-500" />
        </div>
        <Footer />
      </main>
     );
   }
  if (error || !data) {
    return (
       <main className="min-h-screen bg-navy-950">
        <Navbar />
        <div className="flex items-center justify-center min-h-[70vh] text-navy-300">
          <div className="text-center">
            <div className="text-2xl mb-2">⚠</div>
            <div>Failed to load budget data{error ? `: ${error}` : ""}.</div>
          </div>
        </div>
        <Footer />
      </main>
     );
   }

  const { totals, discretionaryTotal, mandatoryTotal, exhibits, byOrganization, byActivity, documents, lineItemCount } =
     data;

  // FY2026 -> FY2027 grand-total delta.
  const yoyPct =
    totals.fy2026 > 0
       ? ((totals.fy2027 - totals.fy2026) / totals.fy2026) * 100
       : 0;
  const yoyUp = yoyPct >= 0;


  // Trend data for the 3-year grand total (TrendBars).
  const trendData = [
    { label: "FY25", value: totals.fy2025 },
    { label: "FY26", value: totals.fy2026 },
    { label: "FY27", value: totals.fy2027 },
   ];

  // Discretionary vs mandatory donut segments.
  const discMandSegments = [
     { label: "Discretionary", value: discretionaryTotal, color: "#38bdf8" },
     { label: "Mandatory", value: mandatoryTotal, color: "#fbbf24" },
   ];
  const discPct =
    discretionaryTotal + mandatoryTotal > 0
       ? (discretionaryTotal / (discretionaryTotal + mandatoryTotal)) * 100
       : 0;

  // Top 6 services for the by-service donut.
  const topOrgs = byOrganization.slice(0, 6);
  const orgSegments = topOrgs.map((o, i) => ({
    label: o.label,
    value: o.total,
    color: colorAt(i),
   }));

  return (
      <main className="min-h-screen bg-navy-950">
        <Navbar />

        {/* ---------------- Hero ---------------- */}
        <section className="pt-28 pb-16 px-4 sm:px-6 lg:px-8 border-b border-navy-800 grid-pattern">
          <div className="max-w-6xl mx-auto text-center">
            <div className="inline-block text-xs font-semibold text-accent-400 uppercase tracking-widest mb-4">
              President's Fiscal Year 2027 Budget Request · De-duplicated from official "-1" exhibits
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold text-navy-50 mb-6">
              DoD Budget <span className="gradient-text">FY 2027</span>
            </h1>
            <p className="text-lg text-navy-300 max-w-3xl mx-auto mb-8">
              Interactive analysis of the seven DoD budget display tables (C-1, M-1, O-1, P-1,
              P-1R, R-1, RF-1), sourced directly from the official DoD budget exhibits and stored in
              Neon Postgres.
            </p>
            <div className="inline-flex flex-col sm:flex-row items-center gap-4 px-6 py-4 glass-card rounded-2xl">
              <div className="text-left">
                <div className="text-xs text-navy-400 uppercase tracking-wide">Total FY2027 Request</div>
                <div className="text-3xl font-bold text-navy-50 tabular-nums">{fmtT(totals.fy2027)}</div>
              </div>
              <div className="h-10 w-px bg-navy-700 hidden sm:block" />
              <div className="text-left">
                <div className="text-xs text-navy-400 uppercase tracking-wide">Change vs FY2026</div>
                <div
                  className={`text-2xl font-bold tabular-nums ${
                    yoyUp ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {yoyUp ? "▲" : "▼"} {yoyPct >= 0 ? "+" : ""}{yoyPct.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- KPI row ---------------- */}
        <section className="py-14 px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Kpi label="Total FY2027" value={fmtT(totals.fy2027)} sub="all 7 exhibits" />
            <Kpi label="Discretionary" value={fmtT(discretionaryTotal)} sub={fmtPct(discPct) + " of disc+mand"} />
            <Kpi label="Mandatory" value={fmtT(mandatoryTotal)} sub="statutory funding" />
            <Kpi label="FY-over-FY" value={`${yoyUp ? "+" : ""}${yoyPct.toFixed(1)}%`} sub="FY26 → FY27" accent={yoyUp ? "default" : "amber"} />
            <Kpi label="Exhibits" value={String(exhibits.length)} sub="C-1 … RF-1" />
            <Kpi label="Line Items" value={lineItemCount.toLocaleString()} sub="parsed from XLSX" />
          </div>
        </section>

        {/* ---------------- 3-year trend + disc/mand ---------------- */}
        <section className="py-14 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="glass-card rounded-xl p-6">
              <div className="text-sm text-accent-400 font-semibold mb-1">Total Request, FY2025 → FY2027</div>
              <div className="text-xs text-navy-400 mb-5">
                Grand total across all seven exhibits, de-duplicated to one canonical figure per exhibit.
              </div>
              <TrendBars data={trendData} height={220} />
            </div>
            <div className="glass-card rounded-xl p-6 flex flex-col items-center">
              <div className="self-start text-sm text-accent-400 font-semibold mb-1">
                FY2027: Discretionary vs Mandatory
              </div>
              <div className="self-start text-xs text-navy-400 mb-4">
                Statutory (mandatory) vs congressionally-approved (discretionary) funding.
              </div>
              <Donut
                segments={discMandSegments}
                size={200}
                centerLabel="FY2027"
                centerValue={fmtT(totals.fy2027)}
              />
              <div className="flex gap-6 mt-5">
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-3 h-3 rounded-full" style={{ background: "#38bdf8" }} />
                  <span className="text-navy-200">Discretionary</span>
                  <span className="text-navy-50 font-semibold ml-1">{fmtT(discretionaryTotal)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-3 h-3 rounded-full" style={{ background: "#fbbf24" }} />
                  <span className="text-navy-200">Mandatory</span>
                  <span className="text-navy-50 font-semibold ml-1">{fmtT(mandatoryTotal)}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- By service + by activity ---------------- */}
        <section className="py-14 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div>
              <h2 className="text-xl font-bold text-navy-50 mb-1">FY2027 by Service / Component</h2>
              <p className="text-xs text-navy-400 mb-6">
                The six core funding exhibits (M-1, O-1, P-1, P-1R, R-1, RF-1), excluding construction.
              </p>
              <BarList items={topOrgs.map((o) => ({ label: o.label, value: o.total, pct: o.pct }))} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-navy-50 mb-1">FY2027 by Budget Activity</h2>
              <p className="text-xs text-navy-400 mb-6">
                Top 15 budget activities (e.g. Operating Forces, Training &amp; Recruiting, RDT&amp;E).
              </p>
              <BarList items={byActivity.slice(0, 15).map((a) => ({ label: a.activity, value: a.total, pct: a.pct }))} />
            </div>
          </div>
        </section>

        {/* ---------------- 7 exhibit cards (clickable) ---------------- */}
        <section className="py-14 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-xl font-bold text-navy-50 mb-1">The Seven "-1" Exhibits</h2>
            <p className="text-xs text-navy-400 mb-6">
              Click any exhibit to open its deep-dive below. Amounts are de-duplicated to each exhibit's canonical sheet.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {exhibits.map((e, i) => {
                const isActive = e.code === active;
                const exChg =
                  e.byYear.fy2026 > 0
                     ? ((e.byYear.fy2027 - e.byYear.fy2026) / e.byYear.fy2026) * 100
                     : 0;
                const exUp = exChg >= 0;
                return (
                    <button
                    key={e.code}
                    onClick={() => setActive(e.code)}
                    className={`glass-card rounded-xl p-5 text-left transition-all hover:border-accent-500/50 ${
                      isActive ? "border-accent-500 ring-1 ring-accent-500/40" : ""
                     }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span
                        className="text-sm font-bold text-accent-400 px-2 py-0.5 rounded bg-accent-500/10"
                        >
                          {e.name}
                        </span>
                        <MiniSpark
                        points={[e.byYear.fy2025, e.byYear.fy2026, e.byYear.fy2027]}
                        color={colorAt(i)}
                        width={72}
                        height={26}
                       />
                      </div>
                      <div className="text-2xl font-bold text-navy-50 tabular-nums mb-1">
                        {fmtT(e.byYear.fy2027)}
                      </div>
                      <div className="text-xs text-navy-400 mb-3">{e.long}</div>
                      <div className="flex items-center justify-between text-xs">
                        <span
                        className={`font-semibold ${
                          exUp ? "text-emerald-400" : "text-rose-400"
                         }`}
                        >
                          {exUp ? "▲" : "▼"} {exChg >= 0 ? "+" : ""}{exChg.toFixed(1)}%
                        </span>
                        <span className="text-navy-500">{e.rowCount.toLocaleString()} rows</span>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        </section>

        {/* ---------------- Deep-dive panel for the active exhibit ---------------- */}
        {activeExhibit && (
           <section className="py-14 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
             <div className="max-w-6xl mx-auto">
               <div className="flex items-baseline gap-3 mb-1">
                 <span className="text-lg font-bold text-accent-400">{activeExhibit.name}</span>
                 <span className="text-navy-100 font-semibold">{activeExhibit.long}</span>
               </div>
               <p className="text-xs text-navy-400 mb-6">
                 Deep-dive · {activeExhibit.rowCount.toLocaleString()} line items · FY2027 total {fmtT(activeExhibit.byYear.fy2027)}
                {activeExhibit.discMand
                    ? " · discretionary vs mandatory shown"
                    : " · (construction exhibit; no discretionary/mandatory split)"}
               </p>

               {/* mini trend + disc/mand for this exhibit */}
               <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
                 <div className="glass-card rounded-xl p-6">
                   <div className="text-sm text-accent-400 font-semibold mb-4">
                    {activeExhibit.name} · FY2025 → FY2027
                   </div>
                   <TrendBars
                    data={[
                      { label: "FY25", value: activeExhibit.byYear.fy2025 },
                      { label: "FY26", value: activeExhibit.byYear.fy2026 },
                      { label: "FY27", value: activeExhibit.byYear.fy2027 },
                     ]}
                    height={180}
                   />
                 </div>
                 {activeExhibit.discMand && (
                    <div className="glass-card rounded-xl p-6 flex flex-col items-center">
                      <div className="self-start text-sm text-accent-400 font-semibold mb-4">
                        {activeExhibit.name} · FY2027 Funding Mix
                      </div>
                      <Donut
                       segments={[
                          { label: "Discretionary", value: activeExhibit.discretionary, color: "#38bdf8" },
                          { label: "Mandatory", value: activeExhibit.mandatory, color: "#fbbf24" },
                       ]}
                       size={180}
                       centerLabel="FY2027"
                       centerValue={fmtT(activeExhibit.byYear.fy2027)}
                      />
                      <div className="flex gap-6 mt-4">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="w-3 h-3 rounded-full" style={{ background: "#38bdf8" }} />
                          <span className="text-navy-200">Discretionary</span>
                          <span className="text-navy-50 font-semibold ml-1">{fmtT(activeExhibit.discretionary)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="w-3 h-3 rounded-full" style={{ background: "#fbbf24" }} />
                          <span className="text-navy-200">Mandatory</span>
                          <span className="text-navy-50 font-semibold ml-1">{fmtT(activeExhibit.mandatory)}</span>
                        </div>
                      </div>
                    </div>
                  )}
               </div>

               {/* interactive detail table */}
               <h3 className="text-lg font-bold text-navy-50 mb-4">
                {activeExhibit.name} · Line-Item Explorer
               </h3>
               <DetailTable exhibit={active} onLoaded={undefined} />
             </div>
           </section>
        )}

        {/* ---------------- Source documents ---------------- */}
        <section className="py-14 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-xl font-bold text-navy-50 mb-1">Source Documents</h2>
            <p className="text-xs text-navy-400 mb-6">
              {documents.length} cataloged FY2027 files (PDF + Excel). "Downloadable" items are
              streamed directly from the Neon bytea store; others link to war.gov.
            </p>
            <DocumentPanel documents={documents} />
          </div>
        </section>

        <Footer />
      </main>
   );
}
