import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { applyBatchRecipe, batchOutputName, hasBatchAction, type BatchRecipe } from '@/lib/batch';
import { summarizeStructures } from '@/lib/verify/structural';

const recipe: BatchRecipe = {
  rotate: 90,
  watermark: 'APROBADO',
  pageNumbers: true,
  flattenForms: true,
};

async function fixture(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([400, 300]);
  first.drawText('PRIMERA', { x: 40, y: 240, font, size: 16 });
  const second = document.addPage([400, 300]);
  second.drawText('SEGUNDA', { x: 40, y: 240, font, size: 16 });
  const field = document.getForm().createTextField('nombre');
  field.setText('Tobias');
  field.addToPage(first, { x: 40, y: 160, width: 180, height: 24 });
  return (await document.save()).slice();
}

describe('batch recipe', () => {
  it('requires at least one real action', () => {
    expect(hasBatchAction({ rotate: 0, watermark: ' ', pageNumbers: false, flattenForms: false })).toBe(false);
    expect(hasBatchAction({ rotate: 0, watermark: '', pageNumbers: true, flattenForms: false })).toBe(true);
  });

  it('applies rotation, watermark, numbering and form flattening together', async () => {
    const result = await applyBatchRecipe(await fixture(), recipe, 'de');
    const output = await PDFDocument.load(result.bytes);

    expect(result.pages).toBe(2);
    expect(result.flattenedFields).toBe(1);
    expect(output.getPages().map((page) => page.getRotation().angle)).toEqual([90, 90]);
    expect(output.getForm().getFields()).toEqual([]);
    expect(summarizeStructures(output).categories.form).toBe(0);

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: result.bytes.slice() });
    const opened = await task.promise;
    const text: string[] = [];
    for (let page = 1; page <= opened.numPages; page += 1) {
      const content = await (await opened.getPage(page)).getTextContent();
      text.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    await task.destroy();
    expect(text.join(' ')).toContain('APROBADO');
    expect(text[0]).toContain('1 de 2');
    expect(text[1]).toContain('2 de 2');
  });

  it('does not mutate the source bytes', async () => {
    const source = await fixture();
    const before = source.slice();
    await applyBatchRecipe(source, recipe, 'de');
    expect(Array.from(source)).toEqual(Array.from(before));
  });

  it('uses indexed output names so duplicate input names cannot overwrite each other', () => {
    expect(batchOutputName('report.pdf', 0)).toBe('001-report_batch.pdf');
    expect(batchOutputName('report.PDF', 1)).toBe('002-report_batch.pdf');
  });
});
