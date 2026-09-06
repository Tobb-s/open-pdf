import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFStream, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib';
import { readPageStream, scanPageText } from '@/lib/pdf/pageText';
import { rewriteSelectedNative, rewriteSelectedWithCompatibleFont } from '@/lib/studio/nativeText';
import { materialize } from '@/lib/studio/materialize';
import { stateAt, type Edit, type TextRewrite } from '@/lib/studio/script';
import { replacementFailure } from '@/lib/studio/replacementRecovery';
import { readFile } from 'node:fs/promises';

const target = { x: 40, y: 200, font: 'Courier-Bold', size: 11 };
const choice = { family: 'courier' as const, bold: true, italic: false };
const rewrite = (extra: Partial<TextRewrite> = {}): TextRewrite => ({
  needle: 'ALPHA', replacement: 'ZETA', fit: 'keep-layout', occurrence: 0, target, ...extra,
});
async function fixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.CourierBold);
  const page = doc.addPage([400, 300]);
  page.drawText('prefix ALPHA suffix', { x: 40 - 7 * 6.6, y: 200, font, size: 11, color: rgb(0.2, 0.4, 0.7) });
  page.drawText('ALPHA', { x: 40, y: 150, font, size: 11 });
  page.drawRectangle({ x: 20, y: 20, width: 60, height: 25 });
  page.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [5, 5, 15, 15], Contents: PDFString.of('Keep note') })));
  await font.embed();
  const chars = [...new Set('prefix ALPHA suffix')];
  const cmap = `1 begincodespacerange <00> <FF> endcodespacerange ${chars.length} beginbfchar\n`
    + chars.map(c => `<${c.charCodeAt(0).toString(16)}> <${c.charCodeAt(0).toString(16).padStart(4, '0')}>`).join('\n') + '\nendbfchar';
  doc.context.lookup(font.ref, PDFDict).set(PDFName.of('ToUnicode'), doc.context.register(doc.context.flateStream(cmap)));
  const second = doc.addPage([400, 300]);
  second.node.set(PDFName.of('Contents'), page.node.get(PDFName.of('Contents'))!);
  second.node.set(PDFName.of('Resources'), page.node.Resources()!);
  return new Uint8Array(await doc.save());
}

describe('explicit compatible font recovery', () => {
  it('recovers a real two-byte embedded subset while preserving one-byte replacement boundaries', async () => {
    const source = await PDFDocument.create();
    const kit = await import('@pdf-lib/fontkit');
    source.registerFontkit((kit as unknown as { default: Parameters<PDFDocument['registerFontkit']>[0] }).default);
    const font = await source.embedFont(await readFile(new URL('./fixtures/LiberationSans-Regular.ttf', import.meta.url)), { subset: true });
    source.addPage([400, 300]).drawText('prefix ALPHA suffix', { x: 20, y: 200, size: 11, font });
    const original = await source.save();
    const doc = await PDFDocument.load(original);
    const page = doc.getPage(0);
    const before = scanPageText(page).scan.runs[0];
    expect(before.font?.codeBytes).toBe(2);
    const selected = { x: before.glyphs[7].x, y: before.glyphs[7].y, size: 11, font: before.font!.baseFont };
    expect(() => rewriteSelectedNative(page, rewrite({ target: selected }))).toThrow('missing-glyphs');
    await rewriteSelectedWithCompatibleFont(page, rewrite({ target: selected, replacementFont: { family: 'helvetica', bold: false, italic: false } }));
    const output = await PDFDocument.load(await doc.save());
    const after = scanPageText(output.getPage(0)).scan;
    expect(after.text).toBe('prefix ZETA suffix');
    expect(after.runs.find(r => r.glyphs.map(g => g.text).join('') === ' suffix')?.font?.codeBytes).toBe(2);
    expect(after.runs.find(r => r.glyphs.map(g => g.text).join('') === 'ZETA')?.font?.codeBytes).toBe(1);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: await doc.save(), stopAtErrors: true });
    try {
      const pdf = await task.promise;
      const content = await (await pdf.getPage(1)).getTextContent();
      expect(content.items.filter(i => 'str' in i).map(i => i.str).join('')).toContain('ZETA');
    } finally { await task.destroy(); }
  });
  it('keeps the default strict and reports exact missing characters', async () => {
    const doc = await PDFDocument.load(await fixture());
    let issue;
    try { rewriteSelectedNative(doc.getPage(0), rewrite()); }
    catch (error) { issue = replacementFailure(error); }
    expect(issue).toEqual({ reason: 'missing-glyphs', missing: ['Z', 'E', 'T'] });
    expect(scanPageText(doc.getPage(0)).scan.text).toContain('prefix ALPHA suffix');
  });

  it.each(['squeeze', 'keep-layout', 'keep-flow'] as const)('substitutes only the selected span under %s', async fit => {
    const doc = await PDFDocument.load(await fixture());
    const page = doc.getPage(0);
    const originalResources = doc.getPage(1).node.Resources()!;
    const originalFontEntries = originalResources.lookup(PDFName.Font, PDFDict).entries();
    const source = scanPageText(page).scan;
    const suffixX = source.runs[0].glyphs[13].x;
    await rewriteSelectedWithCompatibleFont(page, rewrite({ replacementFont: choice, fit }));
    const scan = scanPageText(page).scan;
    expect(scan.text).toContain('prefix ZETA suffix');
    expect(scan.text.match(/ALPHA/g)).toHaveLength(1);
    const after = scan.runs.find(r => r.glyphs.map(g => g.text).join('') === ' suffix')!;
    const replacement = scan.runs.find(r => r.glyphs.map(g => g.text).join('') === 'ZETA')!;
    expect(replacement.fontResource).not.toBe(after.fontResource);
    expect(after.fontResource).toBe(source.runs[0].fontResource);
    expect(after.glyphs[1].x).toBeCloseTo(suffixX + (fit === 'keep-flow' ? -6.6 : 0), 3);
    expect(doc.getPage(1).node.Resources()).toBe(originalResources);
    expect(page.node.Resources()).not.toBe(originalResources);
    expect(originalResources.lookup(PDFName.Font, PDFDict).entries()).toEqual(originalFontEntries);
    expect(scanPageText(doc.getPage(1)).scan.text).toBe(source.text);
    expect(page.node.Annots()?.size()).toBe(1);
    expect(readPageStream(page).bytes).not.toEqual(readPageStream(doc.getPage(1)).bytes);
  });

  it('keeps page geometry, style overrides and vector structure after export', async () => {
    const originalDoc = await PDFDocument.load(await fixture());
    originalDoc.getPage(0).setRotation(degrees(90)); originalDoc.getPage(0).setCropBox(10, 10, 350, 250);
    const original = await originalDoc.save();
    const edit: Edit = { kind: 'rewriteText', page: 'o0', rewrite: rewrite({ replacementFont: choice, sizeRatio: 1.25, color: { r: 1, g: 0, b: 0 } }) };
    const result = await materialize({ original, assets: new Map(), state: stateAt(2, [edit], 1) });
    const doc = await PDFDocument.load(result.bytes);
    const page = doc.getPage(0);
    expect(page.getRotation().angle).toBe(90);
    expect(page.getCropBox()).toEqual({ x: 10, y: 10, width: 350, height: 250 });
    expect(scanPageText(page).scan.runs.find(r => r.glyphs.map(g => g.text).join('') === 'ZETA')?.size).toBe(13.75);
    expect(doc.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))).toHaveLength(0);
    expect(new TextDecoder().decode(readPageStream(page).bytes)).toContain('1 0 0 rg');
  });

  it('supports undo, serializable replay and another native edit of the recovered span', async () => {
    const original = await fixture();
    const edits: Edit[] = [{ kind: 'rewriteText', page: 'o0', rewrite: rewrite({ replacementFont: choice }) },
      { kind: 'rewriteText', page: 'o0', rewrite: rewrite({ needle: 'ZETA', replacement: 'OMEGA' }) }];
    expect((await materialize({ original, assets: new Map(), state: stateAt(2, edits, 0) })).bytes).toEqual(original);
    const restored = JSON.parse(JSON.stringify(edits)) as Edit[];
    const result = await materialize({ original, assets: new Map(), state: stateAt(2, restored, 2) });
    expect(scanPageText((await PDFDocument.load(result.bytes)).getPage(0)).scan.text).toContain('OMEGA');
  });

  it.each([
    ['missing target', { target: undefined }], ['wrong target', { target: { ...target, x: 99 } }],
    ['unsupported glyph', { replacement: '字' }], ['excessive fit', { replacement: 'A'.repeat(50), fit: 'squeeze' as const }],
  ])('does not bypass %s with a compatible font', async (_label, extra) => {
    const doc = await PDFDocument.load(await fixture());
    const page = doc.getPage(0);
    const contents = page.node.get(PDFName.of('Contents'));
    const resources = page.node.Resources();
    await expect(rewriteSelectedWithCompatibleFont(page, rewrite({ replacementFont: choice, ...extra }))).rejects.toThrow('native-text:');
    expect(page.node.get(PDFName.of('Contents'))).toBe(contents);
    expect(page.node.Resources()).toBe(resources);
  });
});

describe('recovery error boundary', () => {
  it('keeps unknown failures strict and bounds malformed worker details', () => {
    expect(replacementFailure(new Error('unrelated missing-glyphs'))).toEqual({ reason: 'unsupported', missing: [] });
    expect(replacementFailure(new Error('native-text:missing-glyphs: ["Z",{},"too long"]'))).toEqual({ reason: 'missing-glyphs', missing: ['Z'] });
    expect(replacementFailure(new Error('native-text:split')).reason).toBe('ambiguous');
    expect(replacementFailure(new Error('native-text:missing-glyphs: invalid')).missing).toEqual([]);
  });
});
