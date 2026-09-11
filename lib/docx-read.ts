/**
 * Reading a .docx back in.
 *
 * Export, edit offline in Word, bring it back as a new version -- that round
 * trip was designed for when the export was built (the headings carry their
 * section marks precisely so they can be found again) but the import half only
 * ever parsed JSON, which nobody edits.
 *
 * A .docx is a zip of XML. Node ships the inflate half of that in zlib and
 * nothing that reads the container, so the container is read here: 60 lines
 * against a 4MB dependency that would also have to be audited. The ETL reads
 * the President's Budget workbooks the same way, with the standard library
 * rather than a spreadsheet package, for the same reason -- what is in the file
 * is what is read.
 *
 * This is deliberately forgiving about everything except structure. Formatting,
 * styles, tables, images and revision marks are discarded; paragraphs and the
 * headings that separate them are kept, because they are what a section is.
 */
import zlib from 'zlib';

interface ZipEntry { name: string; data: Buffer }

/** Minimal zip reader: central directory, stored and deflated entries only. */
function unzip(buf: Buffer): ZipEntry[] {
  // End of central directory: signature, scanned from the back because the
  // comment field that follows it is variable length.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66_000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    // The local header repeats the name and extra field with its own lengths.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + compSize);
    try {
      out.push({ name, data: method === 0 ? raw : zlib.inflateRawSync(raw) });
    } catch {
      // A member this reader cannot inflate is skipped rather than failing the
      // document: document.xml is the only one that matters here.
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, '&');

export interface DocxParagraph { text: string; style: string | null }

/** Paragraphs in document order, with the style name where Word recorded one. */
export function docxParagraphs(file: Buffer): DocxParagraph[] {
  const entries = unzip(file);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) throw new Error('no word/document.xml in this file');
  const xml = doc.data.toString('utf8');
  const paras: DocxParagraph[] = [];
  const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(xml)) !== null) {
    const inner = m[1];
    const style = /<w:pStyle w:val="([^"]+)"/.exec(inner)?.[1] ?? null;
    let text = '';
    const tRe = /<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g;
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(inner)) !== null) text += decode(t[1]);
    if (/<w:tab\b/.test(inner)) text += ' ';
    paras.push({ text: text.replace(/\s+/g, ' ').trim(), style });
  }
  return paras;
}

export interface ImportedSection { key: string; title: string; body: string; matched: boolean }

/**
 * Split an edited document back into the sections it was exported as.
 *
 * Matching is on the section TITLE, normalised the same way the corpus
 * normalises headings, so a heading that survived Word's autocorrect still
 * finds its section. Anything before the first recognised heading is kept as
 * front matter under the key `_preamble` rather than dropped: text a person
 * wrote and cannot find again is worse than text in the wrong place.
 */
export function splitIntoSections(paras: DocxParagraph[],
                                  expected: { key: string; title: string; mark?: string | null }[])
    : ImportedSection[] {
  const norm = (s: string) => s.replace(/\(.*?\)/g, ' ').replace(/[^A-Za-z ]/g, ' ')
    .toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 60);
  const want = new Map(expected.map((e) => [norm(e.title), e]));
  const out: ImportedSection[] = [];
  let cur: ImportedSection = { key: '_preamble', title: 'Front matter', body: '', matched: false };
  for (const p of paras) {
    if (!p.text) continue;
    const n = norm(p.text);
    const hit = want.get(n)
      // A heading often carries its mark: "A. Mission Description".
      ?? want.get(norm(p.text.replace(/^\s*([A-Z]{1,4}|\d{1,2})[.)]\s*/, '')));
    const looksHeading = !!hit && (p.text.length < 120
      || (p.style ?? '').toLowerCase().includes('heading'));
    if (hit && looksHeading) {
      if (cur.body.trim() || cur.key !== '_preamble') out.push(cur);
      cur = { key: hit.key, title: hit.title, body: '', matched: true };
      continue;
    }
    cur.body += (cur.body ? '\n\n' : '') + p.text;
  }
  if (cur.body.trim() || cur.matched) out.push(cur);
  return out;
}
