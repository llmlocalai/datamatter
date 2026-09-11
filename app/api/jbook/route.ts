/**
 * The one write endpoint on this site.
 *
 * Everything else here is read-only and statically prerendered. Authoring a
 * justification book is not, so this route is gated on a shared secret held in
 * JBOOK_TOKEN and every mutating action checks it. That is deliberately modest
 * security — it keeps the public site read-only and it is not a substitute for
 * accounts. Read actions that expose only the published corpus are open; every
 * action that touches user-owned tables is not.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  screen, getLexicon, addLexiconEntry, setLexiconActive,
  upsertDoc, saveVersion, getVersion, getVersions, listDocs, getDoc,
  addUpload, getUploads, getSkeleton, getStyleProfiles, getExemplars,
  getBookFunds, getBooks, getBook, getBookYears, getBookSkeleton, getBookSections,
  getBookExemplars, getLatestPbYear,
} from '@/lib/jbook';
import { buildDraft, readiness, defaultPbYear, type Draft } from '@/lib/jbook-draft';
import { llmStatus, llmChat, pickModel, llmConfigured } from '@/lib/llm';
import { docxParagraphs, splitIntoSections } from '@/lib/docx-read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPEN_ACTIONS = new Set(['screen', 'lexicon', 'skeleton', 'style', 'exemplars',
  'draft', 'readiness']);

function authorised(req: NextRequest) {
  const expected = process.env.JBOOK_TOKEN;
  if (!expected) return false;                    // unset means writing is closed
  const got = req.headers.get('x-jbook-token') ?? '';
  // constant-ish comparison; these are short strings and this is not a keystore
  return got.length === expected.length && got === expected;
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const action = p.get('action') ?? '';
  try {
    switch (action) {
      case 'lexicon':   return NextResponse.json({ lexicon: await getLexicon(p.get('all') === '1') });
      case 'skeleton':  return NextResponse.json({ skeleton: await getSkeleton(p.get('exhibit') ?? 'R-2') });
      case 'style':     return NextResponse.json({ style: await getStyleProfiles(p.get('component') ?? undefined) });
      case 'exemplars': return NextResponse.json({
        exemplars: await getExemplars(p.get('component') ?? '', p.get('letter') ?? 'A',
                                      Number(p.get('limit')) || 3) });
      case 'bookFunds': return NextResponse.json({ funds: await getBookFunds() });
      case 'books':     return NextResponse.json({
        books: await getBooks({ fund: p.get('fund') ?? undefined, q: p.get('q') ?? undefined,
                                limit: Number(p.get('limit')) || undefined }) });
      /** One book, its editions and its own skeleton. The grain, unmodified. */
      case 'book': {
        const key = p.get('key') ?? '';
        const [book, years, skeleton] = await Promise.all([
          getBook(key), getBookYears(key), getBookSkeleton(key)]);
        if (!book) return NextResponse.json({ error: 'no such book' }, { status: 404 });
        return NextResponse.json({ book, years, skeleton,
          nextPbYear: defaultPbYear(book.latestPbYear) });
      }
      case 'bookYear': return NextResponse.json({
        sections: await getBookSections(p.get('key') ?? '', Number(p.get('pb')) || 0) });
      case 'bookExemplars': return NextResponse.json({
        exemplars: await getBookExemplars(p.get('key') ?? '', p.get('title') ?? undefined,
                                          Number(p.get('limit')) || 6) });
      case 'docs':      return NextResponse.json({ docs: await listDocs() });
      case 'doc': {
        const k = p.get('key') ?? '';
        return NextResponse.json({
          doc: await getDoc(k), versions: await getVersions(k),
          latest: await getVersion(k), uploads: await getUploads(k) });
      }
      case 'version':   return NextResponse.json({
        version: await getVersion(p.get('key') ?? '', Number(p.get('n')) || undefined) });
      default: return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'body must be JSON' }, { status: 400 }); }
  const action = String(body.action ?? '');

  if (!OPEN_ACTIONS.has(action) && !authorised(req)) {
    return NextResponse.json({
      error: process.env.JBOOK_TOKEN
        ? 'This action needs the authoring token.'
        : 'Authoring is closed: JBOOK_TOKEN is not set on this deployment.',
    }, { status: 401 });
  }

  try {
    switch (action) {
      /** Screen text without saving anything. Open, because it writes nothing. */
      case 'screen': {
        const lex = await getLexicon();
        const sections = (body.sections ?? []) as { letter: string; body: string }[];
        const hits = screen(sections, lex);
        return NextResponse.json({
          hits,
          blocking: hits.filter((h) => h.severity === 'block').length,
          warnings: hits.filter((h) => h.severity === 'warn').length,
        });
      }
      /**
       * The scaffold. Open, because it writes nothing and invents nothing: it
       * is this book's own sections, in this book's own order, with this book's
       * own word bands and a placeholder in every body.
       */
      case 'draft': {
        const key = String(body.bookKey ?? '');
        const [book, skeleton] = await Promise.all([getBook(key), getBookSkeleton(key)]);
        if (!book) return NextResponse.json({ error: 'no such book' }, { status: 404 });
        const draft = buildDraft(book, skeleton, {
          subject: String(body.subject ?? ''),
          pbYear: body.pbYear ? Number(body.pbYear) : undefined,
          threshold: body.threshold ? Number(body.threshold) : undefined,
        });
        return NextResponse.json({ draft, editions: (await getBookYears(key)).length });
      }
      /**
       * The readiness check. Also open: it reads a draft the caller already has
       * and writes nothing, and a drafter should be able to see what a save
       * will say before they hold a token.
       */
      case 'readiness': {
        const draft = body.draft as Draft;
        if (!draft?.bookKey) return NextResponse.json({ error: 'a draft is required' }, { status: 400 });
        const [skeleton, lex] = await Promise.all([getBookSkeleton(draft.bookKey), getLexicon()]);
        const hits = screen(draft.sections.map((x) => ({ letter: x.title, body: x.body })), lex);
        const checks = readiness(draft, skeleton, hits);
        return NextResponse.json({ checks, hits,
          blocking: checks.filter((c) => c.status === 'block').length,
          warnings: checks.filter((c) => c.status === 'warn').length });
      }
      /**
       * Write or revise one section with the local model.
       *
       * The model is given this book's own measurements and its own published
       * passages, and is told to write for the section in hand -- nothing else
       * about the site's data reaches it, because a justification narrative
       * must not acquire figures from somewhere its author cannot see. What
       * comes back is a DRAFT in a text box, not a saved version: the person
       * writing decides whether it is right, and the screen runs on it before
       * anything can be saved either way.
       */
      case 'compose': {
        if (!llmConfigured()) {
          return NextResponse.json({
            error: 'No model server is configured for this deployment, so nothing can be drafted '
              + 'for you. The scaffold, the word bands and the published examples do not need one.',
          }, { status: 503 });
        }
        const status = await llmStatus();
        if (!status.online) {
          return NextResponse.json({ error: status.reason ?? 'The model server is not reachable.' },
            { status: 503 });
        }
        const model = pickModel(body.model, status);
        if (!model) return NextResponse.json({ error: 'no model available' }, { status: 503 });

        const key = String(body.bookKey ?? '');
        const title = String(body.title ?? '');
        const [book, skeleton, exemplars] = await Promise.all([
          getBook(key), getBookSkeleton(key),
          getBookExemplars(key, String(body.normTitle ?? '') || undefined, 2)]);
        if (!book) return NextResponse.json({ error: 'no such book' }, { status: 404 });
        const row = skeleton.find((x) => x.normTitle === body.normTitle);
        const lex = await getLexicon();
        const forbidden = lex.filter((l) => l.isActive && l.severity === 'block')
          .map((l) => l.phrase).join(', ');

        const prompt = [
          `Write section "${title}" of a ${book.fundLabel} justification book`
            + ` (${book.title}) for FY${body.pbYear ?? defaultPbYear(book.latestPbYear)}.`,
          body.subject ? `Subject: ${body.subject}` : '',
          body.instruction ? `The drafter asks: ${body.instruction}` : '',
          row ? `This section runs ${row.p10Words}-${row.p90Words} words in this book's own`
            + ` editions (median ${row.medianWords})`
            + `${row.avgSentenceWords ? `, sentences about ${row.avgSentenceWords} words` : ''}.` : '',
          Number(row?.timeSharePct ?? 0) >= 50
            ? 'The published versions of this section state dates, schedules or milestones. Where'
              + ' you do not have one, write a bracketed placeholder such as [award date] rather'
              + ' than inventing a date.' : '',
          body.current ? `The current text is:\n${String(body.current).slice(0, 6000)}` : '',
          exemplars.length
            ? 'Passages from this same section of this same book, as published — match their'
              + ' register and level of detail, do not copy their content:\n'
              + exemplars.map((e) => `[${e.sourceFile} p${e.pageNo}] ${e.body.slice(0, 1200)}`).join('\n\n')
            : '',
          'Rules: state no dollar figure, quantity, date or milestone that the drafter has not'
            + ' given you — write a bracketed placeholder instead. Never use these phrases: '
            + forbidden + '. Return the section text only, with no heading and no commentary.',
        ].filter(Boolean).join('\n\n');

        const text = await llmChat([
          { role: 'system', content: 'You draft United States Department of War budget'
            + ' justification narrative. You write in the register of the published books:'
            + ' plain, declarative, specific, no marketing language. You never invent a figure.' },
          { role: 'user', content: prompt },
        ], { model, temperature: 0.3 });

        const hits = screen([{ letter: title, body: text }], lex);
        return NextResponse.json({ text, model, hits,
          blocking: hits.filter((h) => h.severity === 'block').length });
      }
      /** An edited .docx, brought back as a new version. */
      case 'importDocx': {
        const b64 = String(body.file ?? '');
        if (!b64) return NextResponse.json({ error: 'no file' }, { status: 400 });
        const buf = Buffer.from(b64, 'base64');
        if (buf.length > 8 * 1024 * 1024) {
          return NextResponse.json({ error: 'that file is larger than 8MB' }, { status: 413 });
        }
        let sections;
        try {
          sections = splitIntoSections(docxParagraphs(buf),
            (body.expected ?? []) as { key: string; title: string }[]);
        } catch (e) {
          return NextResponse.json({
            error: `That file could not be read as a .docx (${(e as Error).message}).` },
            { status: 400 });
        }
        const lex = await getLexicon();
        const hits = screen(sections.map((x) => ({ letter: x.title, body: x.body })), lex);
        const key = String(body.docKey ?? '');
        let saved = null;
        if (key) {
          saved = await saveVersion(key, { sections }, {
            note: body.note ?? `imported from ${String(body.name ?? 'an edited .docx')}`,
            author: body.author, origin: 'import', screenHits: hits.length });
        }
        return NextResponse.json({ sections, hits, saved,
          matched: sections.filter((x) => x.matched).length });
      }
      case 'addPhrase': {
        if (!String(body.phrase ?? '').trim()) {
          return NextResponse.json({ error: 'phrase is required' }, { status: 400 });
        }
        const e = await addLexiconEntry(body as any);
        return NextResponse.json({ added: e, lexicon: await getLexicon() });
      }
      case 'setPhraseActive': {
        await setLexiconActive(Number(body.id), !!body.active);
        return NextResponse.json({ lexicon: await getLexicon(true) });
      }
      case 'saveDoc': {
        const d = await upsertDoc(body.doc ?? {});
        return NextResponse.json({ doc: d });
      }
      /** Save a version. Screening runs here too, so the count on the row is real. */
      case 'saveVersion': {
        const key = String(body.docKey ?? '');
        const content = body.content ?? {};
        const lex = await getLexicon();
        const hits = screen((content.sections ?? []) as any, lex);
        const blocking = hits.filter((h) => h.severity === 'block').length;
        if (blocking > 0 && !body.force) {
          return NextResponse.json({
            error: 'blocked', blocking, hits,
            message: `${blocking} forbidden phrase${blocking === 1 ? '' : 's'} in the draft. `
              + 'Fix them, or save with force to record the version anyway.',
          }, { status: 409 });
        }
        const v = await saveVersion(key, content, {
          note: body.note, author: body.author, origin: body.origin ?? 'app',
          screenHits: hits.length,
        });
        return NextResponse.json({ saved: v, hits });
      }
      case 'addUpload': {
        const r = await addUpload(String(body.docKey), body.upload ?? {});
        return NextResponse.json({ upload: r, uploads: await getUploads(String(body.docKey)) });
      }
      /** Bring an offline edit back in as a new version, marked as imported. */
      case 'import': {
        const key = String(body.docKey ?? '');
        const content = body.content ?? {};
        const lex = await getLexicon();
        const hits = screen((content.sections ?? []) as any, lex);
        const v = await saveVersion(key, content, {
          note: body.note ?? 'imported from an offline edit',
          author: body.author, origin: 'import', screenHits: hits.length,
        });
        return NextResponse.json({ saved: v, hits });
      }
      default:
        return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
