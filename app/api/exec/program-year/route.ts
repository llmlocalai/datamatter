import { NextRequest, NextResponse } from 'next/server';
import { getProgramYearDrill, parseFunds, programYearReady, type PyOrder } from '@/lib/program-year';
import { parseSide, splitReady } from '@/lib/funding';

export const dynamic = 'force-dynamic';

/**
 * One level of the program-year chart: the children of a path, the totals of
 * the path itself, and -- when a single program year is selected -- that year's
 * money across every fiscal year it executes in.
 *
 * Every value from the request is either whitelisted (funds, order) or bound as
 * a parameter (fy, the path keys). The path is capped at the depth of the order
 * it is read against inside getProgramYearDrill.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const fiscalYear = Number(q.get('fy'));
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
    return NextResponse.json({ error: 'fy is required' }, { status: 400 });
  }
  let path: string[] = [];
  try {
    const raw = q.get('path');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) path = parsed.slice(0, 6).map((v) => String(v).slice(0, 80));
    }
  } catch { path = []; }
  const order: PyOrder = q.get('order') === 'object' ? 'object' : 'account';
  try {
    if (!(await programYearReady())) {
      return NextResponse.json({ error: 'The program-year columns are not in this database yet. '
        + 'Run npm run migrate, then npm run refresh.' }, { status: 503 });
    }
    const side = parseSide(q.get('side'));
    if (side !== 'all' && !(await splitReady())) {
      return NextResponse.json({ error: 'The direct/reimbursable split is not in this database yet. '
        + 'Run npm run migrate, then npm run refresh.' }, { status: 503 });
    }
    const out = await getProgramYearDrill({ fiscalYear, funds: parseFunds(q.get('funds')), order, path, side });
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'query failed' }, { status: 500 });
  }
}
