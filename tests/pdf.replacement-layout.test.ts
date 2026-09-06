import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { resolve } from 'node:path';
import { parseOperations } from '@/lib/pdf/contentStream';
import { scanPageText, readPageStream } from '@/lib/pdf/pageText';
import { rewriteSelectedNative, rewriteSelectedWithCompatibleFont } from '@/lib/studio/nativeText';
import type { TextRewrite } from '@/lib/studio/script';

async function fixture({ paint = '0.2 0.4 0.7 rg', matrix = '1 0 0 1 40 200', separate = false } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const page = doc.addPage([400, 400]);
  await font.embed();
  const resource = 'F1';
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font.ref }, ColorSpace: { 'Ink Shade': PDFName.of('DeviceRGB') } }));
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(
    `${paint} BT /${resource} 11 Tf 16 TL ${matrix} Tm `
    + (separate ? '(ALPHA) Tj [( ) -80 (OMEGA)] TJ ' : '(ALPHA OMEGA) Tj ')
    + 'T* (NEXT) Tj ET 20 20 10 10 re f',
  )));
  return doc;
}

async function read(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), stopAtErrors: true,
    standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/' });
  try {
    const pdf = await task.promise, page = await pdf.getPage(1);
    const content = await page.getTextContent(), ops = await page.getOperatorList();
    const colors: string[] = [];
    const stack: string[] = [];
    let color = '#000000';
    ops.fnArray.forEach((op, i) => {
      if (op === pdfjs.OPS.save) stack.push(color);
      if (op === pdfjs.OPS.restore) color = stack.pop() ?? color;
      if (op === pdfjs.OPS.setFillRGBColor || op === pdfjs.OPS.setFillGray) color = ops.argsArray[i][0];
      if (op === pdfjs.OPS.showText || op === pdfjs.OPS.constructPath) colors.push(color);
    });
    return { items: content.items.filter(i => 'str' in i), colors };
  } finally { await task.destroy(); }
}

const target = { x: 40, y: 200, font: 'Courier', size: 11 };
const edit = (extra: Partial<TextRewrite> = {}): TextRewrite => ({
  needle: 'ALPHA', replacement: 'ZETA', fit: 'squeeze', occurrence: 0, target, ...extra,
});

describe('replacement geometry in the real PDF reader', () => {
  for (const fit of ['squeeze', 'keep-layout', 'keep-flow'] as const) {
    for (const separate of [false, true]) {
      it(`${fit}, ${separate ? 'separate TJ with kerning' : 'single Tj'}: retains suffix and next-line origin`, async () => {
        const doc = await fixture({ separate });
        const before = await read(await doc.save());
        await rewriteSelectedWithCompatibleFont(doc.getPage(0), edit({ fit, sizeRatio: 1.25,
          color: { r: 1, g: 0, b: 0 }, replacementFont: { family: 'helvetica', bold: false, italic: false } }));
        const after = await read(await doc.save());
        const oldEnd = before.items.find(i => i.str.includes('OMEGA'))!;
        const newEnd = after.items.find(i => i.str.includes('OMEGA'))!;
        const font = await doc.embedFont(StandardFonts.Helvetica);
        // PDF show strings use glyph widths, not pdf-lib's optional pair kerning.
        const delta = fit === 'keep-flow' ? [...'ZETA'].reduce((sum, c) => sum + font.widthOfTextAtSize(c, 13.75), 0) - 33 : 0;
        expect(newEnd.transform[4] + newEnd.width).toBeCloseTo(oldEnd.transform[4] + oldEnd.width + delta, 2);
        expect(newEnd.height).toBeCloseTo(11, 3);
        expect(after.items.find(i => i.str === 'NEXT')?.transform).toEqual(before.items.find(i => i.str === 'NEXT')?.transform);
        expect(after.colors.at(-1)).toEqual(before.colors.at(-1));
        expect(after.colors).toContain('#ff0000');
        const ops = parseOperations(readPageStream(doc.getPage(0)).bytes);
        expect(ops.some(op => op.operator === 'q' || op.operator === 'Q')).toBe(false);
      });
    }
  }

  it.each(['0 1 -1 0 200 40', '1 0.25 0.15 1 40 200'])('preserves rotated/skewed neighbor geometry: %s', async matrix => {
    const doc = await fixture({ matrix });
    const before = await read(await doc.save());
    const run = scanPageText(doc.getPage(0)).scan.runs[0];
    rewriteSelectedNative(doc.getPage(0), edit({ target: { ...target, x: run.glyphs[0].x, y: run.glyphs[0].y,
      size: 11 * Math.hypot(run.matrix[2], run.matrix[3]) }, sizeRatio: 1.2, color: { r: 1, g: 0, b: 0 } }));
    const after = await read(await doc.save());
    const end = (item: typeof before.items[number]) => {
      const norm = Math.hypot(item.transform[0], item.transform[1]);
      return [item.transform[4] + item.width * item.transform[0] / norm,
        item.transform[5] + item.width * item.transform[1] / norm];
    };
    const originalEnd = end(before.items.find(i => i.str.includes('OMEGA'))!);
    end(after.items.find(i => i.str.includes('OMEGA'))!).forEach((n, i) => expect(n).toBeCloseTo(originalEnd[i], 2));
    expect(after.items.find(i => i.str === 'NEXT')?.transform).toEqual(before.items.find(i => i.str === 'NEXT')?.transform);
  });

  it.each(['', '0.35 g', '0.1 0.2 0.3 0.4 k', '/DeviceRGB cs 0.2 0.4 0.7 sc',
    '0.2 0.4 0.7 rg 0.1 0.5 0.3 sc', '0.2 0.4 0.7 rg q 0 g q 1 g Q Q',
    '/Ink#20Shade cs 0.2 0.4 0.7 scn', '0.00000001 0.4 0.7 rg'])('restores original fill after a color edit: %s', async paint => {
    const doc = await fixture({ paint });
    const before = await read(await doc.save());
    rewriteSelectedNative(doc.getPage(0), edit({ color: { r: 1, g: 0, b: 0 } }));
    const after = await read(await doc.save());
    expect(after.colors).toContain('#ff0000');
    expect(after.colors.slice(-2)).toEqual(before.colors.slice(-2));
  });

  it('deletion with a style override keeps the following word and line origin', async () => {
    const doc = await fixture({ separate: true });
    const before = await read(await doc.save());
    rewriteSelectedNative(doc.getPage(0), edit({ replacement: '', sizeRatio: 1.2, color: { r: 1, g: 0, b: 0 } }));
    const after = await read(await doc.save());
    for (const word of ['OMEGA', 'NEXT']) {
      const first = before.items.find(i => i.str.includes(word))!;
      const last = after.items.find(i => i.str.includes(word))!;
      expect(last.transform[4] + last.width).toBeCloseTo(first.transform[4] + first.width, 2);
      expect(last.transform[5]).toBeCloseTo(first.transform[5], 2);
    }
  });

  it('refuses an unprovable fill restoration without changing the page', async () => {
    const doc = await fixture({ paint: '/DeviceRGB cs (invalid) sc' });
    const page = doc.getPage(0), original = page.node.get(PDFName.of('Contents'));
    expect(() => rewriteSelectedNative(page, edit({ color: { r: 1, g: 0, b: 0 } }))).toThrow('unsupported-operator');
    expect(page.node.get(PDFName.of('Contents'))).toBe(original);
  });

  it('scanner restores both matrices for source q/Q inside a text object', async () => {
    const doc = await fixture();
    const page = doc.getPage(0), bytes = new TextDecoder().decode(readPageStream(page).bytes);
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(
      bytes.replace('(ALPHA OMEGA) Tj', 'q 9 3 Td (ALPHA) Tj Q (OMEGA) Tj'),
    )));
    const scan = scanPageText(page).scan;
    const real = await read(await doc.save());
    for (const name of ['OMEGA', 'NEXT']) {
      const run = scan.runs.find(r => r.glyphs.map(g => g.text).join('') === name)!;
      const item = real.items.find(i => i.str === name)!;
      expect([run.glyphs[0].x, run.glyphs[0].y]).toEqual(item.transform.slice(4));
    }
  });
});
