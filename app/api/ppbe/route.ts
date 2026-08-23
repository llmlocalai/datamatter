import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATA_PATH = path.join(process.cwd(), 'app', 'api', 'data');

// Read a JSON file; returns null on any failure so callers can degrade gracefully.
function readJson<T>(name: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_PATH, name), 'utf-8')) as T;
  } catch {
    return null;
  }
}

// The PPBE program sample (array of { id, program_name, status, review_date }).
interface PPBEProgram {
  id: number;
  program_name: string;
  status: string;
  review_date: string;
}

// The FY2027 justification summary (has omb30_compliance, justification_quality, compliance_rate).
interface PPBESummary {
  omb30_compliance?: {
    submitted: number;
    approved: number;
    pending: number;
    rejected: number;
  };
  justification_quality?: {
    high_quality: number;
    medium_quality: number;
    low_quality: number;
  };
  compliance_rate?: number;
}

/**
 * GET /api/ppbe
 *
 * Assembles the object the PPBE dashboard page consumes from the two source
 * JSON files:
 *   - ppbe_compliance.json  -> per-program rows (drives the compliance overview)
 *   - ppbe.json             -> OMB-30 compliance + justification-quality buckets
 *
 * Returns:
 *   {
 *     ppbe_compliance:  { total_programs, compliant_programs,
 *                         non_compliant_programs, compliance_rate },
 *     omb30_compliance: { submitted, approved, pending, rejected },
 *     justification_quality: { high_quality, medium_quality, low_quality }
 *   }
 */
export async function GET() {
  try {
    const programs = (readJson<PPBEProgram[]>('ppbe_compliance.json') || []).filter(
      (p) => p && typeof p === 'object'
    );
    const summary = readJson<PPBESummary>('ppbe.json') || {};

    const totalPrograms = programs.length;
    const compliantPrograms = programs.filter(
      (p) => (p.status || '').trim().toLowerCase() === 'compliant'
    ).length;
    const nonCompliantPrograms = totalPrograms - compliantPrograms;
    const complianceRate = totalPrograms > 0 ? (compliantPrograms / totalPrograms) * 100 : 0;

    return NextResponse.json({
      ppbe_compliance: {
        total_programs: totalPrograms,
        compliant_programs: compliantPrograms,
        non_compliant_programs: nonCompliantPrograms,
        compliance_rate: Math.round(complianceRate * 10) / 10,
      },
      omb30_compliance: {
        submitted: summary.omb30_compliance?.submitted ?? 0,
        approved: summary.omb30_compliance?.approved ?? 0,
        pending: summary.omb30_compliance?.pending ?? 0,
        rejected: summary.omb30_compliance?.rejected ?? 0,
      },
      justification_quality: {
        high_quality: summary.justification_quality?.high_quality ?? 0,
        medium_quality: summary.justification_quality?.medium_quality ?? 0,
        low_quality: summary.justification_quality?.low_quality ?? 0,
      },
    });
  } catch (error) {
    console.error('Error fetching PPBE data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch PPBE data' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = false;
