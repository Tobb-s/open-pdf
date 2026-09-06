import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb, degrees } from 'pdf-lib';
import { parseOperations } from '@/lib/pdf/contentStream';
import { scanPageText, readPageStream } from '@/lib/pdf/pageText';
import { rewriteSelectedNative } from '@/lib/studio/nativeText';
import { flattenTextRuns } from '@/lib/studio/textReplacement';
import { collectTextPaints, createPaintLookup } from '@/lib/studio/textAppearance';
import { stateAt, type Edit, type TextRewrite } from '@/lib/studio/script';
import { materialize } from '@/lib/studio/materialize';

const target = { x: 40, y: 200, font: 'Times-BoldItalic', size: 12.75 };
const rewrite = (extra: Partial<TextRewrite> = {}): TextRewrite => ({
  needle: 'Original', replacement: 'Revised', occurrence: 0, fit: 'keep-layout', target, ...extra,
});
async function fixture(shared = false) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.TimesRomanBoldItalic);
  const page = document.addPage([400, 300]);
  page.drawText('Original trailing', { x: 40, y: 200, size: 12.75, color: rgb(0.2, 0.4, 0.7), font });
  page.drawText('Original', { x: 40, y: 150, size: 12.75, font });
  page.drawRectangle({ x: 10, y: 10, width: 20, height: 20, color: rgb(1, 0, 0) });
  const annotation = document.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [5, 5, 15, 15], Contents: PDFString.of('Keep note') });
  page.node.addAnnot(document.context.register(annotation));
  if (shared) {
    const second = document.addPage([400, 300]);
    second.node.set(PDFName.of('Contents'), page.node.get(PDFName.of('Contents'))!);
    second.node.set(PDFName.of('Resources'), page.node.Resources()!);
  }
  return new Uint8Array(await document.save());
}

describe('strict selected native replacement', () => {
  it('edits only the selected duplicate and preserves source fonts, graphics and annotations', async () => {
    const original = await fixture();
    const edit: Edit = { kind: 'rewriteText', page: 'o0', rewrite: rewrite() };
    const result = await materialize({ original, assets: new Map(), state: stateAt(1, [edit], 1) });
    const output = await PDFDocument.load(result.bytes);
    const page = output.getPage(0);
    const { scan } = scanPageText(page);
    expect(scan.text).toContain('Revised trailing');
    expect(scan.text.match(/Original/g)).toHaveLength(1);
    expect(scan.runs.filter(r => r.glyphs.length).every(r => r.font?.baseFont === 'Times-BoldItalic')).toBe(true);
    const drawing = (bytes: Uint8Array) => parseOperations(bytes).filter(op => ['m', 'l', 'h', 'f'].includes(op.operator))
      .map(op => ({ operator: op.operator, operands: op.operands.map(v => v.kind === 'number' ? v.value : v.kind) }));
    expect(drawing(readPageStream(page).bytes)).toEqual(drawing(readPageStream((await PDFDocument.load(original)).getPage(0)).bytes));
    expect(drawing(readPageStream(page).bytes).length).toBeGreaterThan(0);
    expect(page.node.Annots()?.size()).toBe(1);
    expect(result.rewrites[0].replaced).toBe(1);
  });

  it('never changes a second page sharing the original content stream', async () => {
    const original = await fixture(true);
    const result = await materialize({ original, assets: new Map(), state: stateAt(2, [{ kind: 'rewriteText', page: 'o0', rewrite: rewrite() }], 1) });
    const output = await PDFDocument.load(result.bytes);
    expect(scanPageText(output.getPage(0)).scan.text).toContain('Revised');
    expect(scanPageText(output.getPage(1)).scan.text).not.toContain('Revised');
    expect(scanPageText(output.getPage(1)).scan.text.match(/Original/g)).toHaveLength(2);
  });

  it('restores original bytes on undo and supports another replacement at the same baseline', async () => {
    const original = await fixture();
    const edits: Edit[] = [{ kind: 'rewriteText', page: 'o0', rewrite: rewrite() },
      { kind: 'rewriteText', page: 'o0', rewrite: rewrite({ needle: 'Revised', replacement: 'Updated' }) }];
    expect((await materialize({ original, assets: new Map(), state: stateAt(1, edits, 0) })).bytes).toEqual(original);
    const result = await materialize({ original, assets: new Map(), state: stateAt(1, edits, 2) });
    expect(scanPageText((await PDFDocument.load(result.bytes)).getPage(0)).scan.text).toContain('Updated trailing');
  });

  it.each([
    ['wrong position', { target: { ...target, x: 90 } }],
    ['wrong font', { target: { ...target, font: 'Helvetica' } }],
    ['wrong size', { target: { ...target, size: 13 } }],
    ['unsupported character', { replacement: '字' }],
    ['excessive squeeze', { replacement: 'A very very very very long replacement', fit: 'squeeze' as const }],
  ])('refuses %s without returning a partial PDF', async (_label, extra) => {
    const original = await fixture();
    await expect(materialize({ original, assets: new Map(), state: stateAt(1,
      [{ kind: 'rewriteText', page: 'o0', rewrite: rewrite(extra) }], 1) })).rejects.toThrow('native-text:');
  });

  it('changing size and color preserves the following text position and font size', async () => {
    const doc = await PDFDocument.load(await fixture());
    const page = doc.getPage(0);
    const before = scanPageText(page).scan.runs[0].glyphs.find(g => g.text === 't')!;
    rewriteSelectedNative(page, rewrite({ sizeRatio: 1.25, color: { r: 1, g: 0, b: 0 } }));
    const scan = scanPageText(page).scan;
    const after = scan.runs.find(r => r.glyphs.some(g => g.text === 't'))!;
    expect(after.glyphs.find(g => g.text === 't')!.x).toBeCloseTo(before.x, 3);
    expect(after.size).toBe(12.75);
    expect(scan.runs.find(r => r.glyphs.map(g => g.text).join('') === 'Revised')?.size).toBeCloseTo(15.9375);
    expect(new TextDecoder().decode(readPageStream(page).bytes)).toContain('1 0 0 rg');
  });

  it('keeps intrinsic geometry after page rotation and crop', async () => {
    const doc = await PDFDocument.load(await fixture());
    const page = doc.getPage(0);
    page.setRotation(degrees(90)); page.setCropBox(10, 10, 360, 260);
    rewriteSelectedNative(page, rewrite());
    expect(page.getRotation().angle).toBe(90);
    expect(page.getCropBox()).toEqual({ x: 10, y: 10, width: 360, height: 260 });
    expect(scanPageText(page).scan.text).toContain('Revised');
  });

  it('deletes a selected word without shifting the following text under fit-to-width', async () => {
    const doc = await PDFDocument.load(await fixture());
    const page = doc.getPage(0);
    const before = scanPageText(page).scan.runs[0].glyphs.find(g => g.text === 't')!;
    rewriteSelectedNative(page, rewrite({ replacement: '', fit: 'squeeze' }));
    const after = scanPageText(page).scan.runs.flatMap(r => r.glyphs).find(g => g.text === 't')!;
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(scanPageText(page).scan.text.match(/Original/g)).toHaveLength(1);
  });

  it('refuses two indistinguishable objects at the same position', async () => {
    const doc = await PDFDocument.load(await fixture());
    const page = doc.getPage(0);
    const content = readPageStream(page).bytes;
    page.node.set(PDFName.of('Contents'), doc.context.obj([doc.context.register(doc.context.flateStream(content)), doc.context.register(doc.context.flateStream(content))]));
    expect(() => rewriteSelectedNative(page, rewrite())).toThrow('native-text:ambiguous');
  });

  it('refuses an undecodable content stream without discarding it', async () => {
    const doc = await PDFDocument.load(await fixture());
    const page = doc.getPage(0);
    const bad = doc.context.register(doc.context.stream('unreadable', { Filter: 'UnsupportedFilter' }));
    page.node.set(PDFName.of('Contents'), doc.context.obj([page.node.get(PDFName.of('Contents')), bad]));
    expect(() => rewriteSelectedNative(page, rewrite())).toThrow('native-text:');
  });
});

describe('precise extraction geometry', () => {
  const viewport = { width: 400, height: 300, scale: 1,
    convertToViewportPoint: (x: number, y: number) => [x, 300 - y],
    convertToPdfPoint: (x: number, y: number) => [x, 300 - y] };
  it('uses vertical font scale, not horizontally stretched width, and keeps decimals', () => {
    const [run] = flattenTextRuns([{ str: 'Wide', fontName: 'f', transform: [25.5, 0, 0, 12.75, 40, 100], width: 70, height: 12.75 }],
      viewport, new Map(), { f: { ascent: 0.75, descent: -0.2 } });
    expect(run.size).toBe(12.75);
    expect(run.visual.height).toBeCloseTo(12.75 * 0.95);
    expect(run.metrics).toBe('font');
  });
  it('keeps a skewed quadrilateral and filters zero-width orphan diacritics', () => {
    const runs = flattenTextRuns([
      { str: 'Skew', transform: [12, 0, 3, 12, 40, 100], width: 40, height: 12 },
      { str: '\u0300', transform: [12, 0, 0, 12, 80, 100], width: 0, height: 12 },
    ], viewport);
    expect(runs).toHaveLength(1);
    expect(runs[0].quad).toHaveLength(4);
    expect(runs[0].visual.width).toBeGreaterThan(40);
  });
});

describe('text paint evidence', () => {
  it('uses stroke opacity for stroked text, reports soft masks as unknown and records layer ids', async () => {
    const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const seq: [keyof typeof OPS, unknown[]][] = [
      ['setFont', ['f', 12]], ['setTextRenderingMode', [1]], ['setStrokeRGBColor', ['#445566']],
      ['setGState', [[['CA', 0.4]]]], ['beginMarkedContentProps', ['OC', { type: 'OCG', id: '17R' }]],
      ['showText', [[{ unicode: 'A', width: 600 }]]], ['setGState', [[['SMask', {}]]]],
      ['showText', [[{ unicode: 'B', width: 600 }]]],
    ];
    const paints = collectTextPaints({ fnArray: seq.map(([name]) => OPS[name]), argsArray: seq.map(([, args]) => args) }, OPS, () => ({}));
    expect(paints[0]).toMatchObject({ color: '#445566', opacity: 0.4, layer: '17R' });
    expect(paints[1].opacity).toBeNull();
  });
  it('tracks transforms, nested graphics state, source colors and invisible text', async () => {
    const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const seq: [keyof typeof OPS, unknown[]][] = [
      ['setFont', ['f', 10]], ['beginText', []], ['moveText', [20, 60]],
      ['setFillRGBColor', ['#123456']], ['showText', [[{ unicode: 'A', width: 600 }]]],
      ['save', []], ['setFillRGBColor', ['#ff0000']], ['setTextRenderingMode', [3]],
      ['setGState', [[['ca', 0.5]]]], ['showText', [[{ unicode: 'B', width: 600 }]]],
      ['restore', []], ['showText', [[{ unicode: 'C', width: 600 }]]],
      ['paintFormXObjectBegin', [[1, 0, 0, 1, 100, 0], [0, 0, 40, 40]]],
      ['beginText', []], ['showText', [[{ unicode: 'D', width: 600 }]]], ['paintFormXObjectEnd', []],
    ];
    const paints = collectTextPaints({ fnArray: seq.map(([name]) => OPS[name]), argsArray: seq.map(([, args]) => args) }, OPS, () => ({}));
    expect(paints.map(p => p.color)).toEqual(['#123456', '#ff0000', '#123456', '#123456']);
    expect(paints[1]).toMatchObject({ x: 26, y: 60, mode: 3, opacity: 0.5 });
    expect(paints[3].x).toBe(100);
    const lookup = createPaintLookup(paints);
    expect(lookup({ str: 'B', fontName: 'f', transform: [10, 0, 0, 10, 26, 60] })?.mode).toBe(3);
    expect(lookup({ str: 'B', fontName: 'f', transform: [10, 0, 0, 10, 200, 60] })).toBeNull();
  });
});
