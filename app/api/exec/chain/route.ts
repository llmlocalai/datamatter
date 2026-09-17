import { NextRequest, NextResponse } from 'next/server';
import {
  chainReady, getChainAuthority, getChainFirst, getChainLag, getChainOc,
  getChainSensitivity, getChainUnits,
} from '@/lib/chain';

export const dynamic = 'force-dynamic';

const VIEWS = new Set(['units', 'authority', 'first', 'oc', 'lag', 'sensitivity']);

/**
 * One view of the funds-distribution chain per request.
 *
 * Everything from the request is either whitelisted (view, metric) or bound as a
 * parameter inside lib/chain. A database with the columns but not the load
 * answers 503, never an empty array: an empty array reads as a Department that
 * obligated nothing and a caller cannot tell it from the truth.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const view = q.get('view') ?? 'units';
  if (!VIEWS.has(view)) {
    return NextResponse.json(
      { error: `view must be one of ${Array.from(VIEWS).join(', ')}` }, { status: 400 });
  }
  const fyRaw = q.get('fy');
  let fy: number | undefined;
  if (fyRaw !== null) {
    const n = Number(fyRaw);
    if (!Number.isInteger(n) || n < 2000 || n > 2100) {
      return NextResponse.json({ error: 'fy must be a fiscal year' }, { status: 400 });
    }
    fy = n;
  }
  const agency = q.get('agency')?.slice(0, 8) || undefined;
  const approp = q.get('appropriation')?.slice(0, 80) || undefined;

  try {
    if (!(await chainReady())) {
      return NextResponse.json({ error: 'The execution-chain tables are not in this database '
        + 'yet. Run npm run migrate, then npm run refresh.' }, { status: 503 });
    }
    const rows = await (async () => {
      switch (view) {
        case 'authority': return getChainAuthority(fy, agency, approp);
        case 'first': return getChainFirst(fy, agency, approp);
        case 'oc': return getChainOc(fy, agency, approp);
        case 'lag': return getChainLag(fy, agency, approp);
        case 'sensitivity': return getChainSensitivity(q.get('metric') === 'd10' ? 'd10' : 'd50');
        default: return getChainUnits(fy);
      }
    })();
    return NextResponse.json({ view, fiscalYear: fy ?? null, rows });
  } catch {
    console.error('[api/exec/chain] query failed for view', view);
    return NextResponse.json({ error: 'The chain query failed.' }, { status: 500 });
  }
}
