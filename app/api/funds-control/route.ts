import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Thin read of the pre-baked funds-control artifact produced by
// scripts/etl_funds_control.py (TAS-level budget execution from file_a).
const DATA_PATH = path.join(process.cwd(), 'app', 'api', 'data');

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fy = searchParams.get('fiscal-year');
  try {
    const raw = fs.readFileSync(path.join(DATA_PATH, 'funds_control.json'), 'utf-8');
    const data = JSON.parse(raw);
    const records = data.records || [];
    if (!records.length) {
      return NextResponse.json(
        { error: 'No funds-control data. Run scripts/etl_funds_control.py first.' },
        { status: 404 }
      );
    }

    // Default to the most complete year (largest total budgetary resources).
    const complete = [...records].sort((a: any, b: any) => b.total_budgetary_resources - a.total_budgetary_resources)[0];
    const selected = fy
      ? records.find((r: any) => r.fiscal_year === Number(fy))
      : complete;
    const record = selected || complete;

    // Trend series across all years for the line chart.
    const trend = records
      .slice()
      .sort((a: any, b: any) => a.fiscal_year - b.fiscal_year)
      .map((r: any) => ({
        fiscal_year: r.fiscal_year,
        total_budgetary_resources: r.total_budgetary_resources,
        obligations_incurred: r.obligations_incurred,
        unobligated_balance: r.unobligated_balance,
        obligation_rate_pct: r.obligation_rate_pct,
      }));

    // Lapse-risk flag: unobligated dollars above 25% of total resources.
    const lapseRisk = (record.unobligated_pct_of_budget || 0) > 25;

    return NextResponse.json({
      ...record,
      source: data.source,
      granularity: data.granularity,
      available_fiscal_years: data.fiscal_years,
      selected_fiscal_year: record.fiscal_year,
      trend,
      lapse_risk_flag: lapseRisk,
    });
  } catch (error) {
    console.error('Error fetching funds-control data:', error);
    return NextResponse.json({ error: 'Failed to fetch funds-control data' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = false;
