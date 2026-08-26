import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  detectPdfFonts,
  embedTextFont,
  extractEmbeddedPdfFonts,
  testEmbeddedFont,
} from '@/lib/studio/fonts';
import { assetsReferencedBy } from '@/lib/studio/store';
import type { Edit } from '@/lib/studio/script';

const fontPath = fileURLToPath(
  new URL('./fixtures/LiberationSans-Regular.ttf', import.meta.url)
);

async function fontkit() {
  const fontkitModule = await import('@pdf-lib/fontkit');
  return (fontkitModule as unknown as {
    default: Parameters<PDFDocument['registerFontkit']>[0];
  }).default;
}

async function sourceWithEmbeddedFont(subset = false): Promise<Uint8Array> {
  const source = await PDFDocument.create();
  source.registerFontkit(await fontkit());
  const font = await source.embedFont(await readFile(fontPath), { subset });
  source.addPage([400, 240]).drawText('FUENTE ORIGINAL', { x: 42, y: 160, size: 22, font });
  return (await source.save()).slice();
}

describe('Studio embedded source fonts', () => {
  it('detects an embedded font from PDF.js and reuses it in the exported PDF', async () => {
    const source = await sourceWithEmbeddedFont();
    const embeddedPrograms = await extractEmbeddedPdfFonts(source);
    const sourceFont = embeddedPrograms[0];
    expect(sourceFont).toBeDefined();
    const fonts = detectPdfFonts(
      { commonObjs: { get: () => ({ name: sourceFont!.name }) } } as never,
      [{ fontName: 'source-font' }],
      embeddedPrograms
    );
    const detected = fonts.get('source-font');
    expect(detected?.bytes?.byteLength).toBeGreaterThan(1000);
    expect(detected?.name).not.toBe('');

    await expect(testEmbeddedFont(detected!.bytes!, 'FUENTE ORIGINAL')).resolves.toBeDefined();

    const output = await PDFDocument.create();
    const textFont = await embedTextFont(
      output,
      {
        kind: 'embedded',
        asset: 'source-font',
        name: detected!.name,
        fallback: { family: 'helvetica', bold: false, italic: false },
      },
      new Map([['source-font', detected!.bytes!]])
    );
    expect(textFont.widthOfTextAtSize('FUENTE ORIGINAL', 22)).toBeGreaterThan(0);
    output.addPage([400, 240]).drawText('FUENTE ORIGINAL', { x: 42, y: 160, size: 22, font: textFont });

    const result = await output.save();
    expect(result.byteLength).toBeGreaterThan(1000);
  });

  it('accepts supported characters before an edit is created', async () => {
    const bytes = new Uint8Array(await readFile(fontPath));
    await expect(testEmbeddedFont(bytes, 'Texto válido')).resolves.toBeDefined();
  });

  it('does not offer a subset font for text it cannot reproduce', async () => {
    const source = await sourceWithEmbeddedFont(true);
    const [subset] = await extractEmbeddedPdfFonts(source);
    expect(subset).toBeDefined();
    await expect(testEmbeddedFont(subset!.bytes, 'TEXTO REESCRITO')).rejects.toThrow();
  });

  it('keeps a reused font in the locally saved Studio session', () => {
    const edits: Edit[] = [{
      kind: 'draw',
      mark: {
        kind: 'text',
        id: 'text',
        page: 'o0',
        x: 20,
        y: 20,
        text: 'Mismo estilo',
        size: 12,
        color: { r: 0, g: 0, b: 0 },
        rotate: 0,
        font: {
          kind: 'embedded',
          asset: 'source-font',
          name: 'Liberation Sans',
          fallback: { family: 'helvetica', bold: false, italic: false },
        },
      },
    }];

    expect(assetsReferencedBy(edits)).toEqual(new Set(['source-font']));
  });

  it('keeps a reused replacement font in the locally saved Studio session', () => {
    const edits: Edit[] = [{
      kind: 'replaceText',
      page: 'o0',
      raster: { asset: 'page-raster', boxes: [] },
      textLayer: { kind: 'textLayer', id: 'layer', page: 'o0', words: [] },
      replacement: {
        kind: 'text',
        id: 'replacement',
        page: 'o0',
        x: 20,
        y: 20,
        text: 'Mismo estilo',
        size: 12,
        color: { r: 0, g: 0, b: 0 },
        rotate: 0,
        font: {
          kind: 'embedded',
          asset: 'source-font',
          name: 'Liberation Sans',
          fallback: { family: 'helvetica', bold: false, italic: false },
        },
      },
    }];

    expect(assetsReferencedBy(edits)).toEqual(new Set(['page-raster', 'source-font']));
  });
});
