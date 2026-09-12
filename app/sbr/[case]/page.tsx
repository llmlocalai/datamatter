import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { Caveat } from '@/components/Provenance';
import { StatTile, DataTable } from '@/components/charts';
import { fmtT, fmtInt } from '@/components/format';
import CaseConsole from '@/components/sbr/CaseConsole';
import {
  getSbrCase, getSbrExceptions, getSbrCaseFactors, getSbrAccountHistory, getSbrEvents,
  getSbrCaseKeys,
} from '@/lib/sbr';
import { CASE_STATES } from '@/lib/sbr-agent';

// The case record carries state a person entered, which changes between loads
// and between visits, so this page is rendered PER REQUEST rather than
// prerendered: `revalidate = 0` makes the segment dynamic.
//
// generateStaticParams is here for routing, not for prerendering. Next 14
// answers 200 for a `notFound()` raised inside a dynamic segment -- it renders
// the right page and tells a monitor that a missing record is fine -- so the
// set of valid case keys is declared instead and `dynamicParams = false` makes
// an unknown key a routing 404 with the status to match. The cost is that a
// case key only resolves while its load is current, which is true of the data
// anyway.
//
// Because the segment is dynamic, `next build` never executes the queries
// below. This page has to be REQUESTED against a running server before a
// release, which is the standing rule here for anything that opts out of
// static generation.
// `revalidate = 0` was tried first and defeats the routing constraint: a fully
// dynamic segment ignores dynamicParams, and Next then answers 200 for the
// missing case. A short ISR window keeps the constraint (and the 404) while
// staying close to live; the case's own record is re-read through the API by
// the console after every write, so a person never waits on the window.
export const revalidate = 30;
export const dynamicParams = false;

export async function generateStaticParams() {
  const keys = await getSbrCaseKeys(5000);
  return keys.map((k) => ({ case: k.caseKey }));
}

export async function generateMetadata({ params }: { params: { case: string } })
    : Promise<Metadata> {
  const c = await getSbrCase(decodeURIComponent(params.case));
  return {
    title: c ? `${c.treasuryAccount} · SBR case · datamatter` : 'SBR case · datamatter',
    description: c
      ? `Audit-risk case for Treasury account ${c.treasuryAccount} in FY${c.fiscalYear}: `
        + `${c.exceptionCount} exception(s), ${c.testCodes}.`
      : 'Statement of Budgetary Resources assurance case.',
  };
}

const TIER_TONE = ['critical', 'warning', 'default'] as const;

export default async function SbrCasePage({ params }: { params: { case: string } }) {
  const caseKey = decodeURIComponent(params.case);
  const c = await getSbrCase(caseKey);
  if (!c) notFound();

  const [exceptions, factors, history, events] = await Promise.all([
    getSbrExceptions(caseKey), getSbrCaseFactors(caseKey),
    getSbrAccountHistory(c.treasuryAccount), getSbrEvents(caseKey),
  ]);

  const state = c.state ?? 'open';
  const scored = factors.reduce((s, f) => s + Number(f.points), 0);

  return (
    <Shell>
      <PageHeader
        eyebrow={`SBR assurance case · FY${c.fiscalYear} · tier ${c.tier}`}
        title={c.accountName ?? c.treasuryAccount}
        lede={`Treasury account ${c.treasuryAccount}. ${c.exceptionCount} exception${c.exceptionCount === 1 ? '' : 's'} against a population of every Department account in File A, each tied to the authority that makes it a question. Nothing on this page concludes that a misstatement exists.`}
      />

      <Section title="Position">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Risk score" value={Number(c.riskScore).toFixed(0)}
            tone={TIER_TONE[c.tier - 1]} sub={`Tier ${c.tier} of 3, out of 100`} />
          <StatTile label="Exposure" value={fmtT(Number(c.exposure))} tone="warning"
            sub="What each test means by it differs; see the findings below" />
          <StatTile label="Recurrence" value={`${c.recurrenceYears} year${c.recurrenceYears === 1 ? '' : 's'}`}
            tone={c.recurrenceYears > 1 ? 'critical' : 'default'}
            sub="Years in this load where the same test fails on this account" />
          <StatTile label="State" value={state.replace(/_/g, ' ')}
            tone={state === 'closed' ? 'good' : 'default'}
            sub={c.ownerOrg ? `Owner ${c.ownerOrg}` : 'No owner recorded'} />
        </div>
        <div className="mt-4 text-xs text-navy-500">
          Fund life {c.fundLife ?? 'unrecorded'}; period of availability{' '}
          {c.bpoa ? `FY${c.bpoa} to FY${c.epoa}` : 'none, which means no-year'}. Reported budgetary
          resources {fmtT(Number(c.totalResources))}, obligations incurred {fmtT(Number(c.obligations))}.
        </div>
      </Section>

      <Section title="What failed, and the criterion that makes it a question"
        note="Each finding names the figures it rests on. The criterion is the authority that turns a number into a question a fund holder has to answer.">
        <div className="space-y-5">
          {exceptions.map((e) => (
            <article key={e.testCode} className="glass-card rounded-lg p-5 border-l-2 border-navy-700">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-[12px] text-accent-400">{e.testCode}</span>
                <h3 className="text-sm font-semibold text-navy-100">{e.name}</h3>
                <span className="rounded border border-navy-700 bg-navy-800/60 px-1.5 py-0.5
                                 text-[11px] font-semibold text-navy-400">{e.severity}</span>
                <span className="text-[11px] text-navy-500">{e.assertion}</span>
              </div>
              <p className="mt-2 text-sm text-navy-200 leading-relaxed max-w-3xl">{e.detail}</p>
              <p className="mt-2 text-xs text-navy-400 leading-relaxed max-w-3xl">
                <span className="text-navy-500">Criterion. </span>{e.criterion}
              </p>
              <p className="mt-1.5 text-xs text-navy-400 leading-relaxed max-w-3xl">
                <span className="text-navy-500">Exposure, {fmtT(Number(e.exposure))}. </span>
                {e.exposureBasis}
              </p>
              <details className="mt-2.5">
                <summary className="text-[11px] text-navy-600 cursor-pointer hover:text-accent-400">
                  The source values this finding rests on
                </summary>
                <pre className="mt-2 overflow-auto rounded border border-navy-800 bg-navy-950/60
                                p-3 text-[11px] text-navy-400">{
                  (() => { try { return JSON.stringify(JSON.parse(e.evidenceJson), null, 2); }
                           catch { return e.evidenceJson; } })()
                }</pre>
              </details>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Why this case is ranked where it is"
        note="The score exists to persuade the organisation that owns the account to spend effort here, so every component carries the sentence that justifies it.">
        <div className="space-y-3">
          {factors.map((f) => (
            <div key={f.factor}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm text-navy-100">{f.factor}</span>
                <span className="text-sm tnum text-navy-300 shrink-0">
                  {Number(f.points).toFixed(1)}<span className="text-navy-600"> / {Number(f.maxPoints).toFixed(0)}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded bg-navy-800 overflow-hidden">
                <div className="h-full rounded bg-[color:var(--series-1)]"
                  style={{ width: `${Math.min(100, (Number(f.points) / Number(f.maxPoints)) * 100)}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-navy-400 leading-relaxed max-w-3xl">{f.detail}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-navy-500">
          Total {scored.toFixed(1)} of 100, placing this case in tier {c.tier}.
          {c.anomalyZ !== null && Number(c.anomalyZ) >= 99 && (
            <> The behavioural component is capped, which means far outside this account&rsquo;s own
            history rather than a measurement.</>
          )}
        </p>
      </Section>

      <Section title="The account’s own position, year by year"
        note="From the same extract. An exception is read against what the account normally does, never against a Department-wide average.">
        <DataTable
          head={['FY', 'Budgetary resources', 'Obligations', 'Unobligated', 'Gross outlays', 'Exceptions']}
          rows={history.map((h) => [
            <span key="y" className="font-semibold text-navy-100">
              FY{h.fiscalYear}{h.submissionPeriod && !h.submissionPeriod.endsWith('P12') ? '*' : ''}
            </span>,
            fmtT(Number(h.totalResources)), fmtT(Number(h.obligations)),
            fmtT(Number(h.unobligated)), fmtT(Number(h.grossOutlays)),
            <span key="e" className={h.exceptions ? 'text-[color:var(--status-warning)]' : 'text-navy-500'}>
              {fmtInt(h.exceptions)}</span>,
          ])}
          caption="An asterisk marks a period-to-date submission."
        />
      </Section>

      <Section title="Work the case"
        note="Deterministic actions read the extract and need no model. Model actions draft prose from a facts block deterministic code assembled, and produce proposals a person accepts or rejects.">
        <CaseConsole caseKey={caseKey} states={CASE_STATES} currentState={state} />
      </Section>

      <Section title="The record"
        note="Append-only. This, with the evidence package and the control-performance history, is what an auditor would be handed.">
        {(c.rootCause || c.correctiveAction) && (
          <div className="space-y-3 mb-6">
            {c.rootCause && (
              <p className="text-sm text-navy-300 leading-relaxed max-w-3xl">
                <span className="text-navy-500">Root cause recorded. </span>{c.rootCause}
              </p>
            )}
            {c.correctiveAction && (
              <p className="text-sm text-navy-300 leading-relaxed max-w-3xl">
                <span className="text-navy-500">Corrective action recorded. </span>{c.correctiveAction}
              </p>
            )}
          </div>
        )}
        {events.length ? (
          <div className="space-y-4">
            {events.map((e) => (
              <div key={e.seq} className="border-l-2 border-navy-700 pl-4">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-navy-500">
                  <span className="tnum">{String(e.createdAt).slice(0, 19).replace('T', ' ')}</span>
                  <span className="text-navy-400">{e.kind}{e.actionCode ? ` · ${e.actionCode}` : ''}</span>
                  <span>by {e.actor}</span>
                  {e.modelLink && <span className="text-accent-400">drafted by {e.modelLink}</span>}
                </div>
                <p className="text-sm text-navy-200 mt-1 leading-relaxed">{e.summary}</p>
                {e.payload && (
                  <details className="mt-1.5">
                    <summary className="text-[11px] text-navy-600 cursor-pointer hover:text-accent-400">
                      The artifact as stored
                    </summary>
                    <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded border
                                    border-navy-800 bg-navy-950/60 p-3 text-[11px] text-navy-400">{e.payload}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-navy-500 italic">
            Nothing recorded on this case yet. Every action taken above, and every state change,
            appends here with the person who made it and the model link that drafted it where one
            did.
          </p>
        )}
        <Caveat>
          A case cannot be closed while the current load still raises its exceptions. That
          precondition is the whole point of the programme: it is what prevents a corrective
          action being reported complete while the control it was meant to install never operates,
          which is the condition the DoD-Wide Oversight and Monitoring weakness describes.
        </Caveat>
      </Section>

      <Section title="">
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href={`/sbr?fy=${c.fiscalYear}`} className="text-accent-400 hover:text-accent-300">
            &larr; The FY{c.fiscalYear} queue
          </Link>
          <Link href="/nfr/budgetary" className="text-navy-400 hover:text-accent-400">
            The material weakness this works on &rarr;
          </Link>
        </div>
      </Section>
    </Shell>
  );
}
