"use client";

import { useState } from "react";
import { fmtBytes, fmtT } from "./Charts";
import type { DocInfo } from "@/lib/fy27-data";

// Format a per-format icon/label for the document chips.
function fmtChip(format: string): { label: string; cls: string } {
  const f = (format || "").toUpperCase();
  if (f === "PDF") return { label: "PDF", cls: "bg-rose-500/15 text-rose-300" };
  if (f === "XLSX" || f === "XLS") return { label: f, cls: "bg-emerald-500/15 text-emerald-300" };
  if (f === "JSON") return { label: "JSON", cls: "bg-amber-500/15 text-amber-300" };
  if (f === "ZIP") return { label: "ZIP", cls: "bg-indigo-500/15 text-indigo-300" };
  return { label: f || "FILE", cls: "bg-navy-700/60 text-navy-300" };
}

export default function DocumentPanel({
  documents,
}: {
  documents: DocInfo[];
}) {
  const [filter, setFilter] = useState("all");

  const byFormat = (f: string) => documents.filter((d) => d.format.toUpperCase() === f);
  const pdfs = byFormat("PDF");
  const xlsx = byFormat("XLSX");

  let list = documents;
  if (filter === "pdf") list = pdfs;
  else if (filter === "xlsx") list = xlsx;
  else if (filter === "stored") list = documents.filter((d) => d.hasBytes);

  const tabs = [
    { key: "all", label: `All (${documents.length})` },
    { key: "pdf", label: `PDF (${pdfs.length})` },
    { key: "xlsx", label: `Excel (${xlsx.length})` },
    { key: "stored", label: `Downloadable (${documents.filter((d) => d.hasBytes).length})` },
   ];

  return (
      <div>
        {/* tabs */}
        <div className="flex flex-wrap gap-2 mb-5">
          {tabs.map((t) => (
             <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filter === t.key
                   ? "bg-accent-500 text-navy-950"
                   : "bg-navy-800 text-navy-300 hover:bg-navy-700"
                }`}
             >
               {t.label}
             </button>
           ))}
        </div>

        {/* grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((d) => {
            const chip = fmtChip(d.format);
            return (
               <div
                key={d.id}
                className="glass-card rounded-xl p-4 flex flex-col justify-between hover:border-accent-500/40 transition-all"
               >
                 <div>
                   <div className="flex items-start justify-between gap-2 mb-2">
                     <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${chip.cls}`}
                     >
                       {chip.label}
                     </span>
                     <span className="text-xs text-navy-500 font-mono">
                       {fmtBytes(d.byteSize)}
                     </span>
                   </div>
                   <div
                    className="text-sm text-navy-100 font-medium leading-snug mb-2"
                    title={d.name}
                   >
                     {d.name}
                   </div>
                   <div className="flex items-center gap-2 text-xs text-navy-400 mb-3">
                     <span
                      className="px-1.5 py-0.5 rounded bg-navy-800 text-navy-300 font-mono uppercase"
                    >
                       {d.docCode}
                     </span>
                     {d.hasBytes ? (
                       <span className="text-emerald-400">● stored</span>
                     ) : (
                       <span className="text-amber-400">○ not stored</span>
                     )}
                   </div>
                 </div>

                 {/* action: download from Neon, or link out if not stored */}
                 {d.hasBytes ? (
                   <a
                    href={`/api/budget-fy27/document?id=${d.id}`}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-accent-500 hover:bg-accent-600 text-navy-950 text-xs font-semibold transition-all hover:shadow-lg hover:shadow-accent-500/20"
                   >
                     <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                     >
                       <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3"
                       />
                     </svg>
                     Download
                   </a>
                 ) : (
                   <a
                    href={d.sourceUrl || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-navy-800 hover:bg-navy-700 text-navy-300 text-xs font-semibold transition-all"
                    title={d.sourceUrl}
                   >
                     <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                     >
                       <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                       />
                     </svg>
                     Open on war.gov
                   </a>
                 )}
               </div>
             );
           })}
        </div>
      </div>
   );
}

// re-export fmtT so the panel can show a per-doc total if needed (unused now).
export { fmtT };
