import { NextRequest, NextResponse } from 'next/server';
import { getPbTree, PB_DIM_ORDER, PB_DIMS, type PbDim } from '@/lib/pb';

export const dynamic = 'force-dynamic';

/**
 * One node's children. The dimension order is taken from the client so the tree
 * can be re-rooted (by component rather than by exhibit, say) without a second
 * endpoint, but every name is checked against the whitelist in lib/pb before it
 * reaches SQL -- these become column names, and a column name cannot be a bound
 * parameter.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const pbYear = Number(q.get('pb')) || 2027;
  const request = Number(q.get('fy')) || pbYear;
  const dims = (q.get('dims') || '').split(',').filter(Boolean)
    .filter((d): d is PbDim => d in PB_DIMS);
  // The path is a JSON array of dimension VALUES, not a delimited string:
  // component names carry spaces and line-item titles carry almost every
  // punctuation mark, so any separator character would eventually appear inside
  // a key and split one node into two.
  let path: string[] = [];
  try {
    const raw = q.get('path');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) path = parsed.map((v) => String(v));
    }
  } catch { path = []; }
  try {
    const out = await getPbTree({
      pbYear, request,
      dims: dims.length ? dims : PB_DIM_ORDER,
      path,
      search: q.get('q') || undefined,
      exhibit: q.get('exhibit') || undefined,
      component: q.get('component') || undefined,
    });
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'query failed' }, { status: 500 });
  }
}
