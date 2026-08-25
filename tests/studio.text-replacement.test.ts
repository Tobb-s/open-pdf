import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { materialize } from '@/lib/studio/materialize';
import { stateAt, type Edit } from '@/lib/studio/script';
import { flattenTextRuns } from '@/lib/studio/textReplacement';

const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (character) => character.charCodeAt(0)
);

const replacementEdit = (): Edit => ({
  kind: 'replaceText',
  page: 'o0',
  raster: { asset: 'flat-page', boxes: [] },
  textLayer: {
    kind: 'textLayer',
    id: 'search-layer',
    page: 'o0',
    words: [{ text: 'PUBLICO', x: 40, y: 100, size: 14, rotate: 0 }],
  },
  replacement: {
    kind: 'text',
    id: 'new-text',
    page: 'o0',
    x: 40,
    y: 200,
    text: 'NUEVO',
    size: 14,
    color: { r: 0, g: 0, b: 0 },
    rotate: 0,
    font: { family: 'helvetica', bold: false, italic: false },
  },
});

describe('text replacement geometry', () => {
  it('maps an extracted run into the flattened visual page', () => {
    const viewport = {
      width: 400,
      height: 300,
      scale: 1,
      convertToPdfPoint: (x: number, y: number) => [x, 300 - y],
      convertToViewportPoint: (x: number, y: number) => [x, 300 - y],
    };
    const [run] = flattenTextRuns(
      [{ str: 'Texto', transform: [12, 0, 0, 12, 40, 100], width: 60, height: 12 }],
      viewport
    );

    expect(run.text).toBe('Texto');
    expect(run.x).toBeCloseTo(40);
    expect(run.y).toBeCloseTo(100);
    expect(run.rotate).toBeCloseTo(0);
    expect(run.visual.left).toBeCloseTo(40);
    expect(run.visual.width).toBeCloseTo(60);
    expect(run.visual.top).toBeLessThan(200);
    expect(run.visual.top + run.visual.height).toBeGreaterThan(200);
  });

  it('uses the viewport rotation rather than assuming an upright page', () => {
    const viewport = {
      width: 300,
      height: 400,
      scale: 1,
      convertToPdfPoint: (x: number, y: number) => [y, x],
      convertToViewportPoint: (x: number, y: number) => [y, x],
    };
    const [run] = flattenTextRuns(
      [{ str: 'Giro', transform: [12, 0, 0, 12, 40, 100], width: 50, height: 12 }],
      viewport
    );

    expect(Math.abs(run.rotate)).toBeCloseTo(90);
    expect(run.x).toBeCloseTo(100);
    expect(run.y).toBeCloseTo(360);
  });
});

describe('secure text replacement', () => {
  it('removes the old page text while keeping the replacement and rebuilt search layer', async () => {
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    const page = source.addPage([400, 300]);
    page.drawText('VIEJO', { x: 40, y: 200, size: 14, font });
    page.drawText('PUBLICO', { x: 40, y: 100, size: 14, font });
    const original = (await source.save()).slice();

    const edit = replacementEdit();
    const { bytes } = await materialize({
      original,
      assets: new Map([['flat-page', PNG]]),
      state: stateAt(1, [edit], 1),
    });

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: bytes.slice() });
    const output = await task.promise;
    const content = await (await output.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    await task.destroy();

    expect(text).toContain('NUEVO');
    expect(text).toContain('PUBLICO');
    expect(text).not.toContain('VIEJO');
  });

  it('is one atomic undo step and replaces marks already baked into the bitmap', () => {
    const edit = replacementEdit();
    const before = stateAt(1, [edit], 0);
    const after = stateAt(1, [edit], 1);

    expect(before.pages[0].raster).toBeNull();
    expect(before.marks).toEqual([]);
    expect(after.pages[0].raster?.asset).toBe('flat-page');
    expect(after.marks.map((mark) => mark.id)).toEqual(['search-layer', 'new-text']);
  });
});
