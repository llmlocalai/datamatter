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
} from '@/lib/jbook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPEN_ACTIONS = new Set(['screen', 'lexicon', 'skeleton', 'style', 'exemplars']);

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
