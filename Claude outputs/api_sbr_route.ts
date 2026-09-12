/**
 * The SBR case endpoint: actions, and the workflow.
 *
 * Follows the same posture as `/api/jbook`. Everything that only reads the
 * published extract is open; everything that writes a case -- its state, its
 * root cause, its corrective action, or a model's proposal onto its timeline --
 * needs the shared secret in SBR_TOKEN. Unset means writing is closed, which is
 * the right default for a deployment nobody has configured: a public site
 * cannot be allowed to move a remediation case.
 *
 * Nothing here logs a prompt or a completion. Errors report the status.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  SBR_ACTIONS, runSbrAction, recordEvent, CASE_STATES, buildContext,
} from '@/lib/sbr-agent';
import { getSbrCase, getSbrEvents } from '@/lib/sbr';
import { query } from '@/lib/db';
import { llmStatus } from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_TEXT = 20_000;

function authorised(req: NextRequest) {
  const expected = process.env.SBR_TOKEN;
  if (!expected) return false;
  const got = req.headers.get('x-sbr-token') ?? '';
  return got.length === expected.length && got === expected;
}

const closed = () => NextResponse.json({
  error: process.env.SBR_TOKEN
    ? 'This action needs the remediation token.'
    : 'Case updates are closed on this deployment: SBR_TOKEN is not set. The read-only '
      + 'views, the evidence package and the test re-run all work without it.',
}, { status: 403 });

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const action = p.get('action') ?? 'actions';
  const caseKey = p.get('case') ?? '';
  try {
    switch (action) {
      case 'actions':
        return NextResponse.json({
          actions: SBR_ACTIONS,
          writable: !!process.env.SBR_TOKEN,
          states: CASE_STATES,
          model: await llmStatus(),
        });
      case 'case': {
        if (!caseKey) return NextResponse.json({ error: 'No case named.' }, { status: 400 });
        const c = await getSbrCase(caseKey);
        if (!c) return NextResponse.json({ error: 'No such case.' }, { status: 404 });
        return NextResponse.json({ case: c, events: await getSbrEvents(caseKey) });
      }
      case 'context': {
        // The exact block the model would be given. Published deliberately: an
        // artifact whose inputs cannot be inspected is not reviewable.
        if (!caseKey) return NextResponse.json({ error: 'No case named.' }, { status: 400 });
        const ctx = await buildContext(caseKey);
        if (!ctx) return NextResponse.json({ error: 'No such case.' }, { status: 404 });
        return NextResponse.json({ header: ctx.header, facts: ctx.facts });
      }
      default:
        return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Request failed.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 }); }

  const action = String(body.action ?? '');
  const caseKey = String(body.case ?? '');
  if (!caseKey) return NextResponse.json({ error: 'No case named.' }, { status: 400 });

  const c = await getSbrCase(caseKey);
  if (!c) return NextResponse.json({ error: 'No such case.' }, { status: 404 });

  try {
    // ---------------------------------------------------------- run an action
    if (action === 'run') {
      const code = String(body.code ?? '');
      const act = SBR_ACTIONS.find((a) => a.code === code);
      if (!act) return NextResponse.json({ error: 'Unknown action code.' }, { status: 400 });

      // A deterministic action only reads, so it is open. A model action and
      // every timeline write are gated: they put text on a remediation record.
      const willRecord = body.record === true;
      if ((act.kind === 'model' || willRecord) && !authorised(req)) return closed();

      const result = await runSbrAction(caseKey, code);
      if (!result.ok) return NextResponse.json(result, { status: 503 });

      if (willRecord) {
        const actor = String(body.actor ?? '').slice(0, 80) || 'unattributed';
        await recordEvent({
          caseKey, kind: 'action', actionCode: code, actor,
          modelLink: result.modelLink ?? null,
          summary: result.summary, payload: result.payload.slice(0, 200_000),
        });
      }
      return NextResponse.json(result);
    }

    // -------------------------------------------------------- move the case
    if (action === 'state') {
      if (!authorised(req)) return closed();
      const state = String(body.state ?? '');
      if (!(CASE_STATES as readonly string[]).includes(state)) {
        return NextResponse.json({ error: 'Unknown state.' }, { status: 400 });
      }
      const actor = String(body.actor ?? '').slice(0, 80) || 'unattributed';
      const fields = {
        owner_org: body.ownerOrg ? String(body.ownerOrg).slice(0, 200) : null,
        root_cause: body.rootCause ? String(body.rootCause).slice(0, MAX_TEXT) : null,
        corrective_action: body.correctiveAction
          ? String(body.correctiveAction).slice(0, MAX_TEXT) : null,
        due_date: body.dueDate ? String(body.dueDate).slice(0, 10) : null,
        note: body.note ? String(body.note).slice(0, MAX_TEXT) : null,
      };

      // Closing a case is the one transition that has a precondition, and it is
      // the precondition the whole programme exists for: a case cannot close
      // while its exceptions are still being raised by the current load.
      if (state === 'closed') {
        const still = await query<{ n: number }>(
          `SELECT count(*)::int AS n FROM dm_sbr_exception e
             JOIN dm_load l ON l.id = e.load_id AND l.is_current
            WHERE e.case_key = $1`, [caseKey]);
        if ((still[0]?.n ?? 0) > 0) {
          return NextResponse.json({
            error: `This case still raises ${still[0].n} exception(s) against the current load. `
              + 'Closing it would record a remediation the tests do not show. Use '
              + '"accepted_risk" if the exception is understood and accepted, and say why in '
              + 'the note.',
          }, { status: 409 });
        }
      }

      await query(
        `INSERT INTO dm_sbr_case_state (case_key, state, owner_org, root_cause,
           corrective_action, due_date, note, updated_at, updated_by,
           remediated_at, closed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now(), $8,
                 CASE WHEN $2 IN ('validating','closed') THEN now() END,
                 CASE WHEN $2 = 'closed' THEN now() END)
         ON CONFLICT (case_key) DO UPDATE SET
           state = EXCLUDED.state,
           owner_org = COALESCE(EXCLUDED.owner_org, dm_sbr_case_state.owner_org),
           root_cause = COALESCE(EXCLUDED.root_cause, dm_sbr_case_state.root_cause),
           corrective_action = COALESCE(EXCLUDED.corrective_action,
                                        dm_sbr_case_state.corrective_action),
           due_date = COALESCE(EXCLUDED.due_date, dm_sbr_case_state.due_date),
           note = COALESCE(EXCLUDED.note, dm_sbr_case_state.note),
           updated_at = now(), updated_by = EXCLUDED.updated_by,
           remediated_at = COALESCE(dm_sbr_case_state.remediated_at, EXCLUDED.remediated_at),
           closed_at = EXCLUDED.closed_at`,
        [caseKey, state, fields.owner_org, fields.root_cause, fields.corrective_action,
         fields.due_date, fields.note, actor]);

      await recordEvent({
        caseKey, kind: 'state', actor,
        summary: `State set to ${state}${fields.owner_org ? `, owner ${fields.owner_org}` : ''}`
          + `${fields.due_date ? `, due ${fields.due_date}` : ''}.`,
        payload: [fields.root_cause ? `Root cause: ${fields.root_cause}` : null,
                  fields.corrective_action ? `Corrective action: ${fields.corrective_action}` : null,
                  fields.note ? `Note: ${fields.note}` : null].filter(Boolean).join('\n\n') || null,
      });
      return NextResponse.json({ ok: true, case: await getSbrCase(caseKey) });
    }

    return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Request failed.' }, { status: 500 });
  }
}
