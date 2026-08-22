import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Serves the pre-aggregated Contracting / Procurement Intelligence produced by
// scripts/etl_contracting.py. This is a thin read of a baked JSON artifact — the
// expensive 15M-row scan happens in the ETL, never at request time.
const DATA_PATH = path.join(process.cwd(), 'app', 'api', 'data');

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fy = searchParams.get('fiscal-year');

  try {
    const raw = fs.readFileSync(
       path.join(DATA_PATH, 'contracting_intelligence.json'),
       'utf-8'
    );
    const data = JSON.parse(raw);
    const records = data.records || [];

    if (!records.length) {
      return NextResponse.json(
         { error: 'No contracting data. Run scripts/etl_contracting.py first.' },
         { status: 404 }
      );
    }

    // Default to the most complete fiscal year (largest total_obligation),
    // so a partially-reported current year (e.g. FY2026 mid-year) isn't shown.
    const complete = [...records].sort((a: any, b: any) => b.total_obligation - a.total_obligation)[0];
    const selected = fy
        ? records.find((r: any) => r.fiscal_year === Number(fy))
        : complete;

    const record = selected || complete;

    // Derived competition/competition-exception metrics for the UI.
    const total = record.total_obligation;
    const noSetAside =
        (record.by_set_aside.find((s: any) => s.type === 'NO SET ASIDE USED.' || !s.type?.includes('SMALL') && !s.type?.includes('8(A)') && !s.type?.includes('VETERAN') && !s.type?.includes('WOMEN') && !s.type?.includes('HUBZONE'))?.obligation) || 0;
    const soleSource =
        (record.by_competition_exception
           .filter((c: any) => /SOLE|ONE SOURCE|UNIQUE|FOLLOW-ON|URGENCY|STATUTE|NATIONAL SECURITY/i.test(c.reason))
           .reduce((s: number, c: any) => s + c.obligation, 0)) || 0;

    return NextResponse.json({
      ...record,
      source: data.source,
      vintage: data.vintage,
      available_fiscal_years: data.fiscal_years,
      selected_fiscal_year: record.fiscal_year,
      derived: {
        sole_source_obligation: Math.round(soleSource),
        sole_source_pct: total ? +((soleSource / total) * 100).toFixed(1) : 0,
        no_set_aside_obligation: Math.round(noSetAside),
        no_set_aside_pct: total ? +((noSetAside / total) * 100).toFixed(1) : 0,
      },
    });
  } catch (error) {
    console.error('Error fetching contracting data:', error);
    return NextResponse.json({ error: 'Failed to fetch contracting data' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = false;
