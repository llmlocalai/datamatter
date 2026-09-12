/**
 * The action runner behind the case page: automation driven by the LOCAL model
 * chain rather than by a scripted robot.
 *
 * THE DIVISION OF LABOUR IS THE WHOLE DESIGN.
 *
 *   deterministic code   decides what is true, reads the database, writes it
 *   the local model      decides what to SAY about it, and drafts prose
 *   a person             decides what happens to the case
 *
 * The model never writes a figure, never changes a case's state, and never
 * reaches the database. It is handed a context block that deterministic code
 * assembled from the tested population, and what it returns is stored as a
 * PROPOSAL on the case timeline, attributed to the model link that produced it.
 * Applying a proposal is a separate, human action through `/api/sbr/case`.
 *
 * That is not caution for its own sake. An audit-remediation record whose root
 * cause was written by a model and accepted without a person naming themselves
 * is not evidence, and a package built on it would fail the first time an
 * auditor asked who concluded it.
 *
 * Four rules carried over from `lib/llm.ts` and CLAUDE.md hold here too:
 * nothing is logged; every artifact names the model link that produced it;
 * fallback down the chain happens before the first token; and offline is a
 * normal state that the page reports rather than an error that breaks it.
 */
import { llmChat, llmStatus, type LlmMessage } from './llm';
import { query } from './db';
import {
  getSbrCase, getSbrExceptions, getSbrCaseFactors, getSbrAccountHistory,
  getSbrLinkedWeakness, getSbrEvents,
} from './sbr';

export type ActionKind = 'deterministic' | 'model';

export interface SbrAction {
  code: string;
  label: string;
  kind: ActionKind;
  /** What it does, in the words the page shows the person pressing the button. */
  description: string;
  /** What a person still has to do afterwards. Never empty for a model action. */
  humanStep: string;
}

export const SBR_ACTIONS: SbrAction[] = [
  { code: 'collect_evidence', label: 'Collect the evidence package', kind: 'deterministic',
    description: 'Assembles every figure this case rests on -- the exceptions with their '
      + 'criteria, the source values behind each one, the account’s own six-year position, '
      + 'the population confidence for the year, and the load that produced all of it.',
    humanStep: 'Read it. Nothing here is a conclusion; it is the record a conclusion would '
      + 'have to be drawn from.' },
  { code: 'rerun_tests', label: 'Re-run the tests for this account', kind: 'deterministic',
    description: 'Re-executes every test that touches this account against the current load '
      + 'and reports what changed since the case was opened. This is the step that decides '
      + 'whether a remediation held.',
    humanStep: 'A test that still fails is not remediated, whatever the corrective action says.' },
  { code: 'propose_root_cause', label: 'Propose candidate root causes', kind: 'model',
    description: 'The local model reads the exception pattern, the account history and the '
      + 'material weakness this programme works on, and proposes candidate causes with the '
      + 'evidence for each and what would confirm or refute it.',
    humanStep: 'Candidates only. A person selects one and records it; the model cannot.' },
  { code: 'draft_notification', label: 'Draft the fund holder notice', kind: 'model',
    description: 'Drafts the memo to the organisation that owns the account, stating what was '
      + 'tested, what was found, the criterion, and what is being asked of them.',
    humanStep: 'Check every figure against the evidence package before it is sent, and sign it '
      + 'as a person.' },
  { code: 'draft_cap', label: 'Draft a corrective action plan', kind: 'model',
    description: 'Drafts a corrective action plan against the recorded root cause: the control '
      + 'to be installed, the milestones, and the test that will show it operating.',
    humanStep: 'A plan is not remediation. It becomes remediation when re-running the tests '
      + 'shows the exception gone and it stays gone across loads.' },
  { code: 'assemble_package', label: 'Assemble the audit evidence package', kind: 'deterministic',
    description: 'Produces the package an auditor could test: the population and how it was '
      + 'shown complete, the test and its criterion, the exceptions, the investigation record, '
      + 'the corrective action, and the control-performance history across every load.',
    humanStep: 'This is the deliverable. It is a record, not a dashboard.' },
];

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? 'n/a'
    : (Math.abs(Number(n)) >= 1e9 ? `$${(Number(n) / 1e9).toFixed(2)}B`
      : Math.abs(Number(n)) >= 1e6 ? `$${(Number(n) / 1e6).toFixed(2)}M`
      : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);

export interface SbrContext {
  header: string;
  /** The grounded block handed to the model. Deterministic code built all of it. */
  facts: string;
  caseRow: Awaited<ReturnType<typeof getSbrCase>>;
}

/**
 * Everything the model is allowed to know, assembled from the database.
 *
 * The model is given NO tools and no database access. If a figure is not in
 * this block it cannot appear in the output, and the prompt says so -- the
 * failure mode being designed out is a fluent paragraph containing a number
 * nobody can trace.
 */
export async function buildContext(caseKey: string): Promise<SbrContext | null> {
  const c = await getSbrCase(caseKey);
  if (!c) return null;
  const [exc, factors, history, weakness, events] = await Promise.all([
    getSbrExceptions(caseKey), getSbrCaseFactors(caseKey),
    getSbrAccountHistory(c.treasuryAccount), getSbrLinkedWeakness(), getSbrEvents(caseKey),
  ]);

  const lines: string[] = [];
  lines.push('## The account');
  lines.push(`Treasury Account Symbol: ${c.treasuryAccount}`);
  lines.push(`Name: ${c.accountName ?? 'not carried in the extract'}`);
  lines.push(`Fiscal year under test: FY${c.fiscalYear}`);
  lines.push(`Fund life: ${c.fundLife ?? 'unrecorded'}; period of availability `
    + `${c.bpoa ?? 'none'} to ${c.epoa ?? 'none'}`);
  lines.push(`Reported budgetary resources ${money(c.totalResources)}, `
    + `obligations incurred ${money(c.obligations)}.`);

  lines.push('\n## What failed, and the criterion that makes it a question');
  for (const e of exc) {
    lines.push(`- ${e.testCode} (${e.severity}, assertion: ${e.assertion}) `
      + `exposure ${money(e.exposure)}.`);
    lines.push(`  Finding: ${e.detail}`);
    lines.push(`  Criterion: ${e.criterion}`);
    lines.push(`  Source values: ${e.evidenceJson}`);
  }

  lines.push('\n## Why this case is ranked where it is');
  lines.push(`Risk score ${c.riskScore} of 100, tier ${c.tier}, `
    + `recurring in ${c.recurrenceYears} year(s).`);
  for (const f of factors) lines.push(`- ${f.factor}: ${f.points}/${f.maxPoints}. ${f.detail}`);

  lines.push('\n## The account’s own history, from the same extract');
  for (const h of history) {
    lines.push(`- FY${h.fiscalYear}${h.submissionPeriod && !h.submissionPeriod.endsWith('P12')
      ? ' (period to date)' : ''}: resources ${money(h.totalResources)}, `
      + `obligations ${money(h.obligations)}, unobligated ${money(h.unobligated)}, `
      + `outlays ${money(h.grossOutlays)}, ${h.exceptions} exception(s) raised.`);
  }

  if (weakness.length) {
    lines.push('\n## The material weakness this programme works on');
    for (const w of weakness) {
      if ([3, 4, 5, 6].includes(w.elementNo)) {
        lines.push(`- ${w.elementName} (${w.basis}): ${w.elementText}`);
      }
    }
  }

  if (c.rootCause) lines.push(`\n## Root cause recorded by a person\n${c.rootCause}`);
  if (c.correctiveAction) {
    lines.push(`\n## Corrective action recorded by a person\n${c.correctiveAction}`);
  }
  if (events.length) {
    lines.push('\n## Case timeline');
    for (const e of events.slice(0, 8)) {
      lines.push(`- ${e.kind}${e.actionCode ? ` (${e.actionCode})` : ''} by ${e.actor}: ${e.summary}`);
    }
  }

  return {
    header: `${c.treasuryAccount} · FY${c.fiscalYear} · ${c.accountName ?? ''}`.trim(),
    facts: lines.join('\n'), caseRow: c,
  };
}

/**
 * The standing instruction. Every model call in this subsystem carries it.
 *
 * The first two paragraphs are the ones that matter: a model that concludes a
 * misstatement, or that supplies a figure it was not given, produces an
 * artifact that looks exactly like audit evidence and is not.
 */
export const SBR_SYSTEM = `You support a financial-statement audit remediation programme in a
defense finance organisation. You are working one case at a time on the Statement of Budgetary
Resources.

TWO RULES OVERRIDE EVERYTHING ELSE.

1. You do not conclude that a misstatement, an error, or a violation of law has occurred. The
tests identify where a question has to be asked; only the responsible official, and ultimately
the auditor, answers it. Write "this requires the fund holder to establish whether..." and never
"this account improperly obligated...". If you are asked to conclude, decline and say what
evidence would be needed to reach a conclusion.

2. Every figure you write must appear in the CASE FACTS block you were given. You have no
database, no tools and no other source. If a number you want is not in the block, write what is
missing instead of an estimate. A fluent paragraph containing an untraceable number is the single
worst thing you can produce here, because it reads exactly like evidence.

Also: cite the test code and the criterion when you rely on a finding. Prefer plain declarative
sentences. Be specific and brief. Do not open with a summary of what you are about to do.`;

const PROMPTS: Record<string, (ctx: SbrContext) => string> = {
  propose_root_cause: (ctx) =>
`Propose two or three CANDIDATE root causes for the exceptions on this case.

For each candidate give, in this order:
- the cause, in one sentence, stated as a mechanism rather than a symptom ("the obligation and
  the document that created it are held in different systems with no shared key" is a mechanism;
  "the interface failed" is a symptom)
- the evidence in the case facts that supports it, by test code
- the evidence that would CONFIRM it, and the evidence that would REFUTE it, naming the system or
  record a person would have to go to
- whether the pattern across the account's own history makes it more or less likely

End with one sentence on which candidate you would test first and why. These are candidates for a
person to choose between. Do not state that one IS the cause.

CASE FACTS
${ctx.facts}`,

  draft_notification: (ctx) =>
`Draft a short memo to the organisation that owns this account.

Structure: what was tested and over what population; what was found, with the test code, the
figures and the criterion; what specifically is being asked of them and by when; and what happens
next. Under 350 words. No salutation block, no signature block. Neutral and precise: this memo
asks a question of a fund holder, it does not accuse them.

Mark any place where a date or an addressee is not in the case facts as [TO BE SUPPLIED] rather
than inventing it.

CASE FACTS
${ctx.facts}`,

  draft_cap: (ctx) =>
`Draft a corrective action plan for this case.

Cover: the condition; the root cause it is written against (use the recorded root cause if the
case facts carry one, and say plainly that none is recorded if they do not); the control to be
installed or repaired; milestones with owners expressed as roles rather than names; and -- this
is the part that matters -- the TEST that will demonstrate the control is operating, expressed so
that re-running it produces a pass or a fail rather than a status.

Finish with the validation criterion: how many consecutive reporting periods with the exception
absent would be needed before this case could be closed, and why that number.

Mark anything not in the case facts as [TO BE SUPPLIED].

CASE FACTS
${ctx.facts}`,
};

export interface ActionResult {
  ok: boolean;
  code: string;
  kind: ActionKind;
  summary: string;
  payload: string;
  modelLink?: string | null;
  fellBack?: string[];
  reviewRequired: boolean;
  error?: string;
}

// ------------------------------------------------------- deterministic ----
async function collectEvidence(ctx: SbrContext): Promise<string> {
  const c = ctx.caseRow!;
  const conf = await query<{ metric_label: string; value_pct: string; detail: string }>(
    `SELECT metric_label, value_pct, detail FROM dm_sbr_confidence cf
       JOIN dm_load l ON l.id = cf.load_id AND l.is_current
      WHERE fiscal_year = $1 ORDER BY sort_order`, [c.fiscalYear]);
  const prov = await query<{ vintage: string; extracted_at: string; dataset_key: string }>(
    `SELECT dataset_key, vintage, extracted_at FROM dm_load
      WHERE dataset_key IN ('file_a_sbr','file_b_detail') AND is_current`);

  return [
    `# Evidence package — ${ctx.header}`,
    '',
    'Assembled by deterministic query. No model contributed to any figure below.',
    '',
    '## Population and its confidence',
    ...conf.map((r) => `- ${r.metric_label}: ${r.value_pct ?? 'n/a'}%. ${r.detail}`),
    '',
    '## Provenance',
    ...prov.map((r) => `- ${r.dataset_key}: vintage ${String(r.vintage).slice(0, 10)}, `
      + `extracted ${String(r.extracted_at).slice(0, 19).replace('T', ' ')}`),
    '',
    ctx.facts,
    '',
    '## What this package is not',
    'It contains no conclusion. Every exception above identifies a question and the criterion',
    'that makes it a question. Answering it requires records this extract does not carry --',
    'principally the obligating document, which File A does not reference at all.',
  ].join('\n');
}

async function rerunTests(ctx: SbrContext): Promise<string> {
  const c = ctx.caseRow!;
  const rows = await query<{ test_code: string; fiscal_year: number; exposure: string;
                             detail: string }>(
    `SELECT e.test_code, e.fiscal_year, e.exposure, e.detail
       FROM dm_sbr_exception e JOIN dm_load l ON l.id = e.load_id AND l.is_current
      WHERE e.treasury_account = $1 ORDER BY e.fiscal_year DESC, e.test_code`,
    [c.treasuryAccount]);
  const load = await query<{ vintage: string; loaded_at: string }>(
    `SELECT vintage, loaded_at FROM dm_load WHERE dataset_key = 'file_a_sbr' AND is_current`);
  const thisYear = rows.filter((r) => r.fiscal_year === c.fiscalYear);
  const opened = (c.testCodes ?? '').split(',').filter(Boolean);
  const stillFailing = thisYear.map((r) => r.test_code);
  const cleared = opened.filter((t) => !stillFailing.includes(t));

  return [
    `# Test re-run — ${ctx.header}`,
    '',
    `Current load: vintage ${String(load[0]?.vintage ?? '').slice(0, 10)}, loaded `
      + `${String(load[0]?.loaded_at ?? '').slice(0, 19).replace('T', ' ')}.`,
    '',
    `## FY${c.fiscalYear}, this account`,
    thisYear.length
      ? thisYear.map((r) => `- ${r.test_code}: STILL FAILING. ${r.detail}`).join('\n')
      : '- No test fails on this account in this year against the current load.',
    '',
    cleared.length
      ? `## Cleared since the case was opened\n${cleared.map((t) => `- ${t}: no longer raising an exception.`).join('\n')}`
      : '## Cleared since the case was opened\n- None.',
    '',
    '## Every year in the loaded history',
    rows.length
      ? rows.map((r) => `- FY${r.fiscal_year} ${r.test_code}: exposure `
          + `${money(Number(r.exposure))}`).join('\n')
      : '- No exceptions on this account in any loaded year.',
    '',
    'A test that still fails is not remediated. A test that has cleared in one load is not yet',
    'remediated either: the validation criterion is consecutive loads with the exception absent.',
  ].join('\n');
}

async function assemblePackage(ctx: SbrContext): Promise<string> {
  const c = ctx.caseRow!;
  const trend = await query<{ test_code: string; fiscal_year: number; exceptions: number;
                              population: number; exposure: string }>(
    `SELECT r.test_code, r.fiscal_year, r.exceptions, r.population, r.exposure
       FROM dm_sbr_run r JOIN dm_load l ON l.id = r.load_id AND l.is_current
      WHERE r.test_code = ANY($1) ORDER BY r.test_code, r.fiscal_year`,
    [(c.testCodes ?? '').split(',').filter(Boolean)]);
  const events = await getSbrEvents(c.caseKey);
  const evidence = await collectEvidence(ctx);

  return [
    evidence,
    '',
    '## Control performance history',
    'Exception rate for every test on this case, across every fiscal year in the load. This is',
    'what demonstrates whether a control operated across the period rather than whether a plan',
    'completed.',
    ...trend.map((t) => `- ${t.test_code} FY${t.fiscal_year}: ${t.exceptions} of ${t.population} `
      + `accounts, exposure ${money(Number(t.exposure))}`),
    '',
    '## Investigation and remediation record',
    `State: ${c.state ?? 'open'}${c.ownerOrg ? `, owner ${c.ownerOrg}` : ''}`
      + `${c.dueDate ? `, due ${String(c.dueDate).slice(0, 10)}` : ''}`,
    `Root cause recorded: ${c.rootCause ?? 'none recorded'}`,
    `Corrective action recorded: ${c.correctiveAction ?? 'none recorded'}`,
    '',
    events.length
      ? events.slice().reverse().map((e) => `- ${String(e.createdAt).slice(0, 19).replace('T', ' ')}`
          + ` ${e.kind}${e.actionCode ? ` (${e.actionCode})` : ''} by ${e.actor}`
          + `${e.modelLink ? ` [drafted by ${e.modelLink}]` : ''}: ${e.summary}`).join('\n')
      : '- No events recorded.',
    '',
    '## Attribution',
    'Every figure above was produced by query against the loaded extract. Any text on the',
    'timeline marked "drafted by" was produced by the named model link and accepted, amended or',
    'rejected by the person recorded beside it.',
  ].join('\n');
}

// ------------------------------------------------------------- the runner --
export async function runSbrAction(caseKey: string, code: string): Promise<ActionResult> {
  const action = SBR_ACTIONS.find((a) => a.code === code);
  if (!action) {
    return { ok: false, code, kind: 'deterministic', summary: '', payload: '',
      reviewRequired: false, error: 'Unknown action.' };
  }
  const ctx = await buildContext(caseKey);
  if (!ctx) {
    return { ok: false, code, kind: action.kind, summary: '', payload: '',
      reviewRequired: false, error: 'No such case in the current load.' };
  }

  if (action.kind === 'deterministic') {
    const payload = code === 'collect_evidence' ? await collectEvidence(ctx)
      : code === 'rerun_tests' ? await rerunTests(ctx)
      : await assemblePackage(ctx);
    return { ok: true, code, kind: 'deterministic',
      summary: `${action.label} — built by query over the current load.`,
      payload, modelLink: null, reviewRequired: false };
  }

  const status = await llmStatus();
  if (!status.online) {
    return { ok: false, code, kind: 'model', summary: '', payload: '', reviewRequired: false,
      error: status.reason ?? 'No link in the model chain is answering. '
        + 'The deterministic actions do not need one and still work.' };
  }

  const build = PROMPTS[code];
  const messages: LlmMessage[] = [
    { role: 'system', content: SBR_SYSTEM },
    { role: 'user', content: build(ctx) },
  ];
  try {
    const { text, link, fellBack } = await llmChat(messages, { temperature: 0.2, numCtx: 16384 });
    return { ok: true, code, kind: 'model',
      summary: `${action.label} — drafted by ${link?.label ?? 'an unnamed link'}. `
        + 'A proposal, not a decision.',
      payload: text.trim(), modelLink: link?.label ?? null, fellBack, reviewRequired: true };
  } catch (e: any) {
    // The status, never the body. Nothing is logged.
    return { ok: false, code, kind: 'model', summary: '', payload: '', reviewRequired: false,
      error: `The model chain did not answer (${e?.message ?? 'no detail'}).` };
  }
}

/** Appends to the case timeline. The only write a model-driven action causes. */
export async function recordEvent(opts: {
  caseKey: string; kind: string; actionCode?: string | null; actor: string;
  modelLink?: string | null; summary: string; payload?: string | null;
}) {
  const next = await query<{ seq: number }>(
    `SELECT COALESCE(max(seq), 0) + 1 AS seq FROM dm_sbr_case_event WHERE case_key = $1`,
    [opts.caseKey]);
  const seq = next[0]?.seq ?? 1;
  await query(
    `INSERT INTO dm_sbr_case_event (case_key, seq, kind, action_code, actor, model_link,
       summary, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [opts.caseKey, seq, opts.kind, opts.actionCode ?? null, opts.actor,
     opts.modelLink ?? null, opts.summary, opts.payload ?? null]);
  return seq;
}

export const CASE_STATES = ['open', 'investigating', 'root_cause_identified', 'corrective_action',
  'evidence_submitted', 'validating', 'closed', 'accepted_risk'] as const;
