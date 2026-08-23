"use client";

import { useState, useEffect, useCallback } from "react";
import { fmtT } from "./Charts";
import type { ExhibitCode } from "@/lib/fy27-data";

interface DetailRow {
  account: string;
  accountTitle: string;
  organization: string;
  fy2025: number;
  fy2026: number;
  fy2027: number;
  discretionary: number;
  mandatory: number;
}

interface DetailResp {
  rows: DetailRow[];
  total: number;
  page: number;
  pageSize: number;
  fiscalYear: number;
}

type SortField = "fy2027" | "account" | "accountTitle" | "organization";

// A year-over-year change as a small colored badge (%).
function Delta({ from, to }: { from: number; to: number }) {
  if (from <= 0) return <span className="text-navy-500 text-xs">—</span>;
  const pct = ((to - from) / from) * 100;
  const up = pct >= 0;
  return (
      <span
        className={`inline-flex items-center gap-1 text-xs font-semibold ${
          up ? "text-emerald-400" : "text-rose-400"
        }`}
      >
        <span>{up ? "▲" : "▼"}</span>
        {pct >= 0 ? "+" : ""}
        {pct.toFixed(1)}%
      </span>
  );
}

export default function DetailTable({
  exhibit,
  onLoaded,
}: {
  exhibit: ExhibitCode;
  onLoaded?: (total: number) => void;
}) {
  const [org, setOrg] = useState("all");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [sort, setSort] = useState<SortField>("fy2027");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DetailResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const q = new URLSearchParams({
      exhibit,
      org,
      activity: "all",
      search: appliedSearch,
      sort,
      order,
      page: String(page),
      pageSize: "50",
    });
    try {
      const res = await fetch(`/api/budget-fy27/detail?${q.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DetailResp = await res.json();
      setData(json);
      onLoaded?.(json.total);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [exhibit, org, appliedSearch, sort, order, page, onLoaded]);

  // Single source of truth for refetching: any query param change reloads.
  useEffect(() => {
    load();
  }, [load]);

  // Debounce the search box into appliedSearch; reset to page 1 as you type.
  useEffect(() => {
    const t = setTimeout(() => {
      setAppliedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const onSearch = (v: string) => setSearch(v);

  const toggleSort = (field: SortField) => {
    if (sort === field) {
      setOrder(order === "desc" ? "asc" : "desc");
    } else {
      setSort(field);
      setOrder("desc");
    }
    setPage(1);
  };

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize || 50;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const th = (label: string, field?: SortField, right?: boolean) => (
      <th
        className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-accent-400 ${
          right ? "text-right" : "text-left"
        }`}
        onClick={field ? () => toggleSort(field) : undefined}
        style={field ? { cursor: "pointer", userSelect: "none" } : undefined}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {field && sort === field && (
             <span className="text-navy-300">{order === "desc" ? "▼" : "▲"}</span>
           )}
        </span>
      </th>
  );

  return (
      <div>
        {/* controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search account or title…"
              className="w-full bg-navy-900/60 border border-navy-700 rounded-lg px-3 py-2 text-sm text-navy-100 placeholder:text-navy-500 focus:outline-none focus:border-accent-500"
            />
          </div>
          <select
            value={org}
            onChange={(e) => {
              setOrg(e.target.value);
              setPage(1);
            }}
            className="bg-navy-900/60 border border-navy-700 rounded-lg px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-accent-500"
          >
            <option value="all">All services</option>
            <option value="A">Army</option>
            <option value="N">Navy</option>
            <option value="F">Air Force</option>
            <option value="OSD">OSD (DoD-Wide)</option>
            <option value="DHA">DHA</option>
            <option value="SOCOM">SOCOM</option>
            <option value="MDA">MDA</option>
            <option value="DISA">DISA</option>
            <option value="DLA">DLA</option>
            <option value="DARPA">DARPA</option>
          </select>
        </div>

        {/* table */}
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-navy-800/50 border-b border-navy-700">
                  {th("Account", "account")}
                  {th("Title", "accountTitle")}
                  {th("Service", "organization")}
                  {th("FY26", undefined, true)}
                  {th("FY27", "fy2027", true)}
                  {th("Δ 26→27", undefined, true)}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-navy-400">
                      <span className="inline-flex items-center gap-2">
                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent-500" />
                        Loading…
                      </span>
                    </td>
                  </tr>
                )}
                {!loading && error && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-rose-400">
                      {error}
                    </td>
                  </tr>
                )}
                {!loading && !error && data && data.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-navy-400">
                      No line items match these filters.
                    </td>
                  </tr>
                )}
                {!loading &&
                  !error &&
                  data?.rows.map((r, i) => (
                    <tr
                      key={i}
                      className="border-t border-navy-800/60 hover:bg-navy-800/30 transition-colors"
                    >
                      <td className="px-3 py-2.5 font-mono text-navy-200 whitespace-nowrap">
                        {r.account}
                      </td>
                      <td
                        className="px-3 py-2.5 text-navy-100 max-w-xs truncate"
                        title={r.accountTitle}
                      >
                        {r.accountTitle}
                      </td>
                      <td className="px-3 py-2.5 text-navy-300 whitespace-nowrap">
                        {r.organization}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-navy-300">
                        {fmtT(r.fy2026)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-navy-50">
                        {fmtT(r.fy2027)}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <Delta from={r.fy2026} to={r.fy2027} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-navy-700 text-xs text-navy-300">
            <span>
              {total.toLocaleString()} line items · page {data?.page ?? page} of {pageCount}
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={(data?.page ?? page) <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-md bg-navy-800 hover:bg-navy-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ← Prev
              </button>
              <button
                disabled={(data?.page ?? page) >= pageCount}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-md bg-navy-800 hover:bg-navy-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </div>
  );
}
