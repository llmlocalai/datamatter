/**
 * DOCX export — the editable master.
 *
 * The exported file is the round-trip format: a reviewer edits it offline and
 * the edited text comes back through the import action as a new version. So the
 * structure has to survive the round trip, which is why each section is written
 * with its letter and title as a recognisable heading rather than as styling
 * alone: the importer finds sections by that heading.
 *
 * Format follows the published R-2 — UNCLASSIFIED banners top and bottom, the
 * two-column identification block, the cost table, then the lettered sections in
 * the order the corpus says that exhibit type uses.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDoc, getVersion, getSkeleton } from '@/lib/jbook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key') ?? '';
  const n = Number(req.nextUrl.searchParams.get('n')) || undefined;
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 });

  const [doc, version] = await Promise.all([getDoc(key), getVersion(key, n)]);
  if (!doc || !version) {
    return NextResponse.json({ error: 'no such document or version' }, { status: 404 });
  }

  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, HeadingLevel, WidthType, BorderStyle, Header, Footer, PageNumber,
  } = await import('docx');

  const content = (version.content ?? {}) as {
    sections?: { letter: string; title: string; isTable?: boolean; body: string }[];
    costTable?: { label: string; cells: string[] }[];
    costHeaders?: string[];
  };
  const skeleton = await getSkeleton(doc.exhibit);
  const order = new Map(skeleton.map((s, i) => [s.letter, i]));
  const sections = [...(content.sections ?? [])].sort(
    (a, b) => (order.get(a.letter) ?? 99) - (order.get(b.letter) ?? 99));

  const FONT = 'Times New Roman';
  const t = (text: string, o: Record<string, unknown> = {}) =>
    new TextRun({ text, font: FONT, size: 20, ...o });
  const p = (text: string, o: Record<string, unknown> = {}) =>
    new Paragraph({ children: [t(text, o)], spacing: { after: 120 }, ...(o.align
      ? { alignment: o.align as any } : {}) });

  const banner = (where: 'h' | 'f') => new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'UNCLASSIFIED', font: FONT, size: 18 })],
    spacing: where === 'h' ? { after: 60 } : { before: 60 },
  });

  const idRows: [string, string][] = [
    ['Appropriation / Budget Activity',
     `${doc.appropriation_code ?? ''}${doc.appropriation ? `: ${doc.appropriation}` : ''}`
     + (doc.budget_activity ? ` / BA ${doc.budget_activity}` : '')
     + (doc.budget_activity_title ? `: ${doc.budget_activity_title}` : '')],
    ['Program Element', `${doc.pe ? `PE ${doc.pe}` : ''}${doc.pe_title ? ` / ${doc.pe_title}` : ''}`],
    ...(doc.project_number
      ? [['Project (Number/Name)', `${doc.project_number} / ${doc.project_title ?? ''}`] as [string, string]]
      : []),
    ['R-1 Line', doc.r1_line ? `#${doc.r1_line}` : '—'],
  ];

  const thin = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
  const cell = (text: string, bold = false, width?: number) => new TableCell({
    children: [new Paragraph({ children: [t(text, { bold })] })],
    borders: { top: thin, bottom: thin, left: thin, right: thin },
    ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
  });

  const body: any[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [t(`Exhibit ${doc.exhibit}, ${doc.exhibit === 'R-2A'
        ? 'RDT&E Project Justification' : 'RDT&E Budget Item Justification'}`
        + `: PB ${doc.pb_year} ${doc.component}`, { bold: true, size: 22 })],
      spacing: { after: 200 },
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: idRows.map(([k, v]) => new TableRow({ children: [cell(k, true, 32), cell(v, false, 68)] })),
    }),
    new Paragraph({ text: '', spacing: { after: 200 } }),
  ];

  if (content.costTable?.length) {
    const heads = content.costHeaders ?? [];
    body.push(new Paragraph({ children: [t('COST ($ in Millions)', { bold: true })], spacing: { after: 80 } }));
    body.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        ...(heads.length ? [new TableRow({ children: ['', ...heads].map((h) => cell(h, true)) })] : []),
        ...content.costTable.map((r) =>
          new TableRow({ children: [cell(r.label, true), ...r.cells.map((c) => cell(c))] })),
      ],
    }));
    body.push(new Paragraph({ text: '', spacing: { after: 200 } }));
  }

  for (const s of sections) {
    body.push(new Paragraph({
      children: [t(`${s.letter}. ${s.title}${s.isTable ? ' ($ in Millions)' : ''}`, { bold: true })],
      spacing: { before: 200, after: 100 },
      heading: HeadingLevel.HEADING_2,
    }));
    for (const para of String(s.body ?? '').split(/\n{2,}/)) {
      if (!para.trim()) continue;
      body.push(new Paragraph({
        children: [t(para.trim())],
        spacing: { after: 120 },
        alignment: AlignmentType.JUSTIFIED,
      }));
    }
  }

  const file = new Document({
    creator: 'datamatter',
    title: `${doc.exhibit} ${doc.pe ?? ''} PB${doc.pb_year}`,
    sections: [{
      headers: { default: new Header({ children: [banner('h')] }) },
      footers: {
        default: new Footer({
          children: [
            banner('f'),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                t(`${doc.component}   Page `, { size: 16 }),
                new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16 }),
                t(` of `, { size: 16 }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16 }),
                t(doc.r1_line ? `   R-1 Line #${doc.r1_line}` : '', { size: 16 }),
              ],
            }),
          ],
        }),
      },
      children: body,
    }],
  });

  const buf = await Packer.toBuffer(file);
  const bytes = new Uint8Array(buf);
  const name = `${doc.exhibit}_${doc.pe ?? doc.doc_key}_PB${doc.pb_year}_v${version.versionNo}.docx`;
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });
}
