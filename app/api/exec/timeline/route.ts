import { NextRequest, NextResponse } from 'next/server';
import {
  getApropCalendar, getTimelineAnnual, getTimelineCoverage, getTimelineCyMonths,
  getTimelineHolders, getTimelineModel, getTimelineMonths, getTimelineTrend, timelineReady,
} from '@/lib/timeline';

export const dynamic = 'force-dynamic';

const VIEWS = new Set([
  'calendar', 'months', 'holders', 'annual', 'sample', 'coverage', 'model', 'trend',
]);

/**
 * One view of the execution timeline per request.
 *
 * Every value from the request is either whitelisted (view, dimension) or bound
 * as a parameter (fy, key) inside lib/timeline. Nothing here builds SQL from a
 * string the caller supplied.
 *
 * A database that has the columns but not the load answers 503 rather than an
 * empty array: an empty array reads as "the Department obligated nothing", and
 * a caller cannot tell it from the truth.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const view = q.get('view') ?? 'trend';
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
  const key = q.get('key')?.slice(0, 80) || undefined;

  try {
    if (!(await timelineReady())) {
      return NextResponse.json({ error: 'The execution-timeline tables are not in this database '
        + 'yet. Run npm run migrate, then npm run refresh.' }, { status: 503 });
    }
    const rows = await (async () => {
      switch (view) {
        case 'calendar': return getApropCalendar();
        case 'months': return getTimelineMonths(
          q.get('dimension') === 'fund_holder' ? 'fund_holder' : 'total', fy, key);
        case 'holders': return getTimelineHolders(fy);
        case 'annual': return getTimelineAnnual(fy, q.get('current') === '1');
        case 'sample': return getTimelineCyMonths(fy);
        case 'coverage': return getTimelineCoverage();
        case 'model': return getTimelineModel(fy, key);
        default: return getTimelineTrend();
      }
    })();
    return NextResponse.json({ view, fiscalYear: fy ?? null, rows });
  } catch {
    // The STATUS, never the body: nothing about the database reaches the browser.
    console.error('[api/exec/timeline] query failed for view', view);
    return NextResponse.json({ error: 'The timeline query failed.' }, { status: 500 });
  }
}
