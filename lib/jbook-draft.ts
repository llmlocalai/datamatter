/**
 * Drafting a justification book from the corpus, and checking a draft before it
 * is sent.
 *
 * WHAT A MOCK IS HERE. Asked for a book with nothing but a subject, this builds
 * the SKELETON the chosen book actually prints -- its sections, in its order,
 * with the word band each one runs to in its own recent editions -- and puts a
 * bracketed placeholder in every body. It does not invent figures and it does
 * not paste another programme's paragraphs in as if they were yours. A
 * fabricated number in a justification narrative is worse than a blank one:
 * blank is obviously unfinished, fabricated survives review. Prose comes from
 * the drafter, or from the local model when one is reachable; the scaffold is
 * what makes either of those land in the right shape.
 *
 * THE READINESS CHECK is the first-time-pass part. Reviewers send books back for
 * a small number of repeatable reasons: a required section missing, a section
 * far outside the length its own book runs to, a predecisional reference left in
 * the narrative, a placeholder never filled, and a schedule statement that has
 * gone stale. Each is checked against THIS book's own measured history rather
 * than a house opinion, and each check says what it measured.
 */
import type { JBookSkeletonRow, ScreenHit } from './jbook';

export interface DraftSection {
  key: string;               // normalised title: the join back to the corpus
  mark: string | null;       // A, III, 9 ... as the book prints it
  title: string;
  level: number;
  body: string;
  isRequired: boolean;
  targetWords: number | null;
  lowWords: number | null;
  highWords: number | null;
  timeSharePct: number | null;
  guidance: string;
}

export interface Draft {
  bookKey: string;
  bookTitle: string;
  fundLabel: string;
  pbYear: number;
  basedOnPb: number | null;
  subject: string;
  isMock: boolean;
  sections: DraftSection[];
  note: string;
}

/** A placeholder is bracketed so the readiness check can find one left behind. */
export const PLACEHOLDER = /\[[^\]]{3,}\]/g;

const TIME_LANGUAGE =
  /\b(as of|to date|currently|will (?:begin|complete|award|deliver|start|field|transition)|scheduled?|milestone|IOC|FOC|[1-4]Q ?FY|Q[1-4] ?FY|contract award|delivery of|beginning in FY|through FY|in FY ?\d{2,4})\b/i;

export const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/**
 * The year to write for.
 *
 * The corpus knows the newest book published. A new book is written for the
 * NEXT President's Budget, so the default is that year -- PB2027 is out, so a
 * new one is PB2028 -- and the caller can override it. This is deliberately not
 * derived from today's date: what matters is the newest book actually held, and
 * saying so beats an assumption about the budget calendar.
 */
export function defaultPbYear(latestHeld: number | null): number {
  return (latestHeld ?? new Date().getFullYear() + 1) + 1;
}

/**
 * Which sections a new edition of this book should carry.
 *
 * A section is in if it is still printed in the newest edition held and its
 * recency-weighted share is at least the threshold. Sections dropped years ago
 * are not in the scaffold -- they are shown separately as the book's drift, so
 * nothing is hidden, but a drafter is not asked to write a section their own
 * book stopped printing in PB2021.
 */
export function skeletonForDraft(skeleton: JBookSkeletonRow[], threshold = 50): JBookSkeletonRow[] {
  return skeleton
    .filter((s) => s.isCurrent && Number(s.weightedSharePct ?? 0) >= threshold)
    .sort((a, b) => a.level - b.level || a.rank - b.rank);
}

/** Sections this book used to print and no longer does. Shown, never scaffolded. */
export function droppedSections(skeleton: JBookSkeletonRow[]): JBookSkeletonRow[] {
  return skeleton
    .filter((s) => !s.isCurrent && s.yearsSeen >= 2)
    .sort((a, b) => b.lastSeenPb - a.lastSeenPb);
}

function guidanceFor(s: JBookSkeletonRow): string {
  const band = s.p10Words != null && s.p90Words != null && s.p10Words !== s.p90Words
    ? `${s.p10Words}–${s.p90Words} words across its editions, median ${s.medianWords}`
    : `about ${s.medianWords} words`;
  const seen = `printed in ${s.yearsSeen} of the ${s.yearsTotal} editions held`
    + (s.firstSeenPb === s.lastSeenPb ? ` (PB${s.lastSeenPb})` : ` (PB${s.firstSeenPb}–PB${s.lastSeenPb})`);
  const time = Number(s.timeSharePct ?? 0) >= 50
    ? ` ${Math.round(Number(s.timeSharePct))}% of the published versions of this section carry a date, `
      + 'a schedule or a milestone — this is where the book goes stale first.'
    : '';
  // A "sentence" of ninety words is a table that ran through a sentence
  // splitter, not a style to imitate. Saying so is more use to a drafter than
  // the number, and it is a fact about the section: this is where the book puts
  // a table rather than prose.
  const sent = !s.avgSentenceWords ? ''
    : Number(s.avgSentenceWords) > 60
      ? ' The published versions of this section are mostly tabular — the length above is the table, not prose.'
      : ` Sentences run about ${s.avgSentenceWords} words.`;
  return `${band}; ${seen}.${sent}${time}`;
}

export function buildDraft(book: { bookKey: string; title: string; fundLabel: string;
                                   latestPbYear: number | null },
                           skeleton: JBookSkeletonRow[],
                           opts: { subject?: string; pbYear?: number; threshold?: number } = {}): Draft {
  const subject = (opts.subject ?? '').trim();
  const pbYear = opts.pbYear ?? defaultPbYear(book.latestPbYear);
  const rows = skeletonForDraft(skeleton, opts.threshold ?? 50);
  const who = subject || `[the programme or activity this book covers]`;
  return {
    bookKey: book.bookKey, bookTitle: book.title, fundLabel: book.fundLabel,
    pbYear, basedOnPb: book.latestPbYear, subject, isMock: true,
    sections: rows.map((s) => ({
      key: s.normTitle, mark: s.mark, title: s.title, level: s.level,
      isRequired: s.isRequired,
      targetWords: s.medianWords, lowWords: s.p10Words, highWords: s.p90Words,
      timeSharePct: s.timeSharePct == null ? null : Number(s.timeSharePct),
      guidance: guidanceFor(s),
      body: `[${s.title} — ${who}, FY${pbYear}. `
        + `Write about ${s.medianWords ?? 200} words.`
        + (Number(s.timeSharePct ?? 0) >= 50
            ? ' State the dates and milestones this section carries in the published book.' : '')
        + ']',
    })),
    note: `Scaffold only. The sections, their order and the word bands are read from `
      + `${book.title}'s own editions${book.latestPbYear ? ` up to PB${book.latestPbYear}` : ''}; `
      + `every body is a placeholder and no figure has been supplied. Nothing here has been `
      + `carried over from another programme's book.`,
  };
}

export type CheckStatus = 'pass' | 'warn' | 'block';
export interface ReadinessCheck {
  id: string; section: string | null; status: CheckStatus;
  label: string; detail: string;
}

/**
 * Check a draft against the book it is a new edition of.
 *
 * Every finding names the measurement behind it, because a check a drafter
 * cannot argue with is a check they will route around. A section outside its
 * band is a WARNING, not a block: books legitimately grow and shrink, and a
 * hard limit read off five editions would be false precision. Only three things
 * block -- a required section missing, a placeholder left in, and a phrase the
 * lexicon refuses -- and each of those is objectively wrong rather than unusual.
 */
export function readiness(draft: Draft, skeleton: JBookSkeletonRow[],
                          hits: ScreenHit[]): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];
  // Placeholders are collected rather than listed one per section: a fresh
  // scaffold has one in every section, and eight identical blocking rows push
  // the findings that differ off the screen.
  const placeholders: { title: string; count: number; first: string }[] = [];
  const bySection = new Map(draft.sections.map((s) => [s.key, s]));
  const required = skeletonForDraft(skeleton).filter((s) => s.isRequired);

  for (const r of required) {
    const s = bySection.get(r.normTitle);
    if (!s || words(s.body) === 0) {
      out.push({ id: `missing:${r.normTitle}`, section: r.title, status: 'block',
        label: 'Required section is empty',
        detail: `${r.title} is printed in ${r.yearsSeen} of the ${r.yearsTotal} editions of this `
          + `book held here, including the newest. A book without it is not this book.` });
    }
  }

  for (const s of draft.sections) {
    const n = words(s.body);
    if (n === 0) continue;
    const left = s.body.match(PLACEHOLDER);
    if (left) {
      placeholders.push({ title: s.title, count: left.length, first: left[0] });
      continue;
    }
    if (s.lowWords != null && s.highWords != null && (n < s.lowWords || n > s.highWords)) {
      out.push({ id: `length:${s.key}`, section: s.title, status: 'warn',
        label: n < s.lowWords ? 'Shorter than this book runs' : 'Longer than this book runs',
        detail: `${n} words against ${s.lowWords}–${s.highWords} in this book's own editions `
          + `(median ${s.targetWords}). Not wrong in itself — but a reviewer reading the last `
          + `edition beside it will notice.` });
    }
    if (Number(s.timeSharePct ?? 0) >= 50 && !TIME_LANGUAGE.test(s.body)) {
      out.push({ id: `timing:${s.key}`, section: s.title, status: 'warn',
        label: 'No date or schedule where the book carries one',
        detail: `${Math.round(Number(s.timeSharePct))}% of the published versions of ${s.title} `
          + `state a date, a schedule or a milestone. This draft states none. Either the schedule `
          + `belongs here, or say why it does not.` });
    }
  }

  if (placeholders.length === 1) {
    const one = placeholders[0];
    out.push({ id: `placeholder:${one.title}`, section: one.title, status: 'block',
      label: 'Placeholder left in the text',
      detail: `${one.count} bracketed placeholder${one.count > 1 ? 's remain' : ' remains'}, `
        + `starting ${one.first.slice(0, 60)}${one.first.length > 60 ? '…' : ''}.` });
  } else if (placeholders.length > 1) {
    out.push({ id: 'placeholder:all', section: null, status: 'block',
      label: `${placeholders.length} sections still carry a placeholder`,
      detail: `${placeholders.map((x) => x.title).slice(0, 6).join('; ')}`
        + `${placeholders.length > 6 ? `; and ${placeholders.length - 6} more` : ''}. `
        + 'A scaffold starts this way — every body is a placeholder until it is written.' });
  }

  for (const h of hits) {
    out.push({ id: `lexicon:${h.phrase}:${h.letter}:${h.index}`, section: h.letter,
      status: h.severity === 'block' ? 'block' : 'warn',
      label: h.severity === 'block' ? `"${h.phrase}" must not go to Congress` : `"${h.phrase}" — review`,
      detail: `${h.rationale}${h.suggestion ? ` Write instead: ${h.suggestion}.` : ''}`
        + `${h.authority ? ` (${h.authority})` : ''} …${h.excerpt}…` });
  }

  if (!out.some((c) => c.status === 'block')) {
    out.unshift({ id: 'ready', section: null, status: 'pass',
      label: 'Nothing blocking',
      detail: `Every section this book requires carries text, no placeholder is left, and no `
        + `phrase in the lexicon appears. ${out.filter((c) => c.status === 'warn').length} `
        + `thing(s) worth a second look remain.` });
  }
  return out;
}
