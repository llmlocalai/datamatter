import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATA_PATH = path.join(process.cwd(), 'app', 'api', 'data');

// A single year's findings row (drives the "Findings Over Time" table + totals).
interface YearlyFindings {
  year: number;
  findings: number;
  material_weaknesses: number;
}

// A finding-type bucket (drives the "Finding Types Distribution" cards).
interface FindingType {
  type: string;
  count: number;
}

// The shape the GAO dashboard page consumes.
interface GaoSummary {
  findings_by_year?: YearlyFindings[];
  finding_types?: FindingType[];
}

/**
 * GET /api/gao
 *
 * Returns the two collections the GAO dashboard renders:
 *    findings_by_year  -> per-year { findings, material_weaknesses }
 *    finding_types     -> per-type { type, count }
 *
 * Sourced from gao.json (the aggregated GAO report inventory), NOT the raw
 * gao_audit.json sample array — the page expects the object shape above.
 */
export async function GET() {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(DATA_PATH, 'gao.json'), 'utf-8')
    ) as GaoSummary;

    const findingsByYear = Array.isArray(raw.findings_by_year)
      ? raw.findings_by_year
          .filter((y) => y && typeof y === 'object')
          .map((y) => ({
            year: Number(y.year) || 0,
            findings: Number(y.findings) || 0,
            material_weaknesses: Number(y.material_weaknesses) || 0,
          }))
      : [];

    const findingTypes = Array.isArray(raw.finding_types)
      ? raw.finding_types
          .filter((t) => t && typeof t === 'object')
          .map((t) => ({ type: String(t.type || 'Unspecified'), count: Number(t.count) || 0 }))
      : [];

    return NextResponse.json({ findings_by_year: findingsByYear, finding_types: findingTypes });
  } catch (error) {
    console.error('Error fetching GAO data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch GAO data' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = false;
