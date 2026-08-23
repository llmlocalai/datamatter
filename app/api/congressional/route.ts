import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATA_PATH = path.join(process.cwd(), 'app', 'api', 'data');

// A raw oversight-request record from congressional_tracking.json.
interface RequestRecord {
  id?: number;
  committee?: string;
  request_date?: string;   // "YYYY-MM-DD"
  response_date?: string | null; // null => not yet responded
  status?: string;
}

// A raw scheduled hearing from congressional.json.
interface HearingRecord {
  committee?: string;
  chamber?: string;
  session?: number;
  hearing_id?: string;
  title?: string;
  date?: string; // "YYYY-MM-DD"
}

// Read a JSON file; returns null on any failure so callers can degrade gracefully.
function readJson<T>(name: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_PATH, name), 'utf-8')) as T;
   } catch {
    return null;
   }
}

// Turn "YYYY-MM-DD" into a "YYYY Qn" label (Q1 = Jan-Mar, ... Q4 = Oct-Dec).
// Falls back to an "Unspecified" bucket when the date is missing/unparseable.
function quarterLabel(iso: string | undefined | null): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso || '');
  if (!m) return 'Unspecified';
  const year = m[1];
  const month = parseInt(m[2], 10);
  const q = Math.min(4, Math.max(1, Math.ceil(month / 3)));
  return `${year} Q${q}`;
}

/**
 * GET /api/congressional
 *
 * Assembles the object the Congressional Oversight dashboard consumes from the two
 * source files (neither of which already has the right shape):
 *
 *   oversight_requests  <- congressional_tracking.json
 *                          Each record is aggregated into a fiscal quarter as
 *                          { quarter, requests, responses } where `responses`
 *                          counts records whose response_date is set.
 *
 *   testimony_scheduled <- congressional.json (12 real scheduled hearings)
 *                          Mapped to { committee, date, witnesses }. The source
 *                          carries no per-hearing witness count, so `witnesses`
 *                          defaults to 1 (at least one testifier per hearing).
 */
export async function GET() {
  try {
    // ---- oversight_requests: aggregate the raw request records by quarter ----
    const records = (readJson<RequestRecord[]>('congressional_tracking.json') || []).filter(
       (r) => r && typeof r === 'object'
     );

    const byQuarter = new Map<string, { requests: number; responses: number }>();
    for (const r of records) {
      const q = quarterLabel(r.request_date);
      const acc = byQuarter.get(q) || { requests: 0, responses: 0 };
      acc.requests += 1;
      // A non-null response_date means the request was answered.
      if (r.response_date != null && String(r.response_date).trim() !== '') {
        acc.responses += 1;
       }
      byQuarter.set(q, acc);
     }
    const oversight_requests = Array.from(byQuarter.entries())
       .map(([quarter, v]) => ({ quarter, requests: v.requests, responses: v.responses }))
       .sort((a, b) => a.quarter.localeCompare(b.quarter));

    // ---- testimony_scheduled: map the real hearings to the page's shape ----
    const source = readJson<{ testimony_scheduled?: HearingRecord[] }>('congressional.json') || {};
    const testimony_scheduled = (Array.isArray(source.testimony_scheduled) ? source.testimony_scheduled : [])
       .filter((t) => t && typeof t === 'object')
       .map((t) => ({
        committee: t.committee || 'Unknown committee',
        date: t.date || '',
        witnesses: 1,
       }));

    return NextResponse.json({ oversight_requests, testimony_scheduled });
   } catch (error) {
    console.error('Error fetching congressional data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch congressional data' },
      { status: 500 }
     );
   }
}

export const dynamic = 'force-dynamic';
export const revalidate = false;
