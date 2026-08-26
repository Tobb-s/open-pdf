import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { materialize } from '@/lib/studio/materialize';
import { stateAt, type Edit } from '@/lib/studio/script';

const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (character) => character.charCodeAt(0)
);

describe('paragraph editing in a produced PDF', () => {
  it('removes the old block, writes reflowed lines and keeps unrelated searchable text', async () => {
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    const page = source.addPage([400, 300]);
    page.drawText('PARRAFO ANTIGUO', { x: 40, y: 200, size: 14, font });
    page.drawText('TEXTO AJENO', { x: 40, y: 100, size: 14, font });
    const original = (await source.save()).slice();
    const edit: Edit = {
      kind: 'rewritePages',
      pages: [
        {
          page: 'o0',
          raster: { asset: 'paragraph-page', boxes: [] },
          marks: [
            {
              kind: 'textLayer',
              id: 'search-layer',
              page: 'o0',
              words: [{ text: 'TEXTO AJENO', x: 40, y: 100, size: 14, rotate: 0 }],
            },
            {
              kind: 'text',
              id: 'line-one',
              page: 'o0',
              x: 40,
              y: 200,
              text: 'PARRAFO NUEVO',
              size: 14,
              color: { r: 0, g: 0, b: 0 },
              rotate: 0,
              font: { family: 'times', bold: true, italic: false },
            },
            {
              kind: 'text',
              id: 'line-two',
              page: 'o0',
              x: 40,
              y: 182,
              text: 'SEGUNDA LINEA',
              size: 14,
              color: { r: 0, g: 0, b: 0 },
              rotate: 0,
              font: { family: 'times', bold: true, italic: false },
            },
          ],
        },
      ],
    };

    const { bytes } = await materialize({
      original,
      assets: new Map([['paragraph-page', PNG]]),
      state: stateAt(1, [edit], 1),
    });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: bytes.slice() });
    const output = await task.promise;
    const content = await (await output.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    await task.destroy();

    expect(text).toContain('PARRAFO NUEVO');
    expect(text).toContain('SEGUNDA LINEA');
    expect(text).toContain('TEXTO AJENO');
    expect(text).not.toContain('PARRAFO ANTIGUO');
  });
});
