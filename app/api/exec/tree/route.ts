import { NextRequest, NextResponse } from 'next/server';
import { getExecTree, EXEC_DIMS, EXEC_DIM_ORDER, type ExecDim } from '@/lib/execution';

export const dynamic = 'force-dynamic';

/**
 * One node's children in the File B explorer. The dimension order comes from the
 * client so the same rows can be read component-first or object-class-first, but
 * every name is checked against the whitelist in lib/execution before it reaches
 * SQL: these become column expressions, and a column expression cannot be a
 * bound parameter.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const fiscalYear = Number(q.get('fy'));
  if (!Number.isFinite(fiscalYear)) {
    return NextResponse.json({ error: 'fy is required' }, { status: 400 });
  }
  const dims = (q.get('dims') || '').split(',').filter(Boolean)
    .filter((d): d is ExecDim => d in EXEC_DIMS);
  let path: string[] = [];
  try {
    const raw = q.get('path');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) path = parsed.map((v) => String(v));
    }
  } catch { path = []; }
  try {
    const out = await getExecTree({
      fiscalYear, dims: dims.length ? dims : EXEC_DIM_ORDER, path,
      search: q.get('q') || undefined,
    });
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'query failed' }, { status: 500 });
  }
}
