import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { exportOcrPages, summarizeOcrPages } from '@/lib/ocrResult';
import type { OcrPageResult } from '@/lib/ocrAdvanced';

const page = (number: number, text = 'CHECKPOINT'): OcrPageResult => ({
  page: number, text, words: [{ text, left: 20, top: 30, right: 160, bottom: 50, confidence: 95 }],
  width: 300, height: 400, toPdf: [1, 0, 0, -1, 0, 400], orientation: 0,
  attempts: 1, milliseconds: 10, skipped: false, preview: '',
});

describe('resumable OCR results', () => {
  it('distinguishes completed pages from total pages', () => {
    expect(summarizeOcrPages([page(1)], 3)).toMatchObject({ pages: 3, partial: true, wordsFound: 1 });
    expect(summarizeOcrPages([page(1)], 1).partial).toBe(false);
  });
  it('copies the checkpoint array before more pages are appended', () => {
    const pages = [page(1)];
    const checkpoint = summarizeOcrPages(pages, 2);
    pages.push(page(2));
    expect(checkpoint.recognized).toHaveLength(1);
  });
  it.each([[page(2)], [page(1), page(1)], [page(1), page(3)]])('rejects noncontiguous or duplicate pages', (...pages) => {
    expect(() => summarizeOcrPages(pages, 3)).toThrow('checkpoint');
  });
  it('rejects invalid total and too many completed pages', () => {
    expect(() => summarizeOcrPages([], 0)).toThrow();
    expect(() => summarizeOcrPages([page(1), page(2)], 1)).toThrow();
  });
  it('recomputes metrics after corrections including deleted and unsupported text', () => {
    const first = page(1);
    first.words.push({ ...first.words[0], text: '→', confidence: 40 }, { ...first.words[0], text: '' });
    expect(summarizeOcrPages([first], 1)).toMatchObject({ wordsFound: 1, lowConfidence: 1, stripped: 1 });
  });
  it('retains native-only and empty completed pages as resumable checkpoints', () => {
    const first = { ...page(1), skipped: true, words: [] };
    const second = { ...page(2, ''), words: [] };
    expect(summarizeOcrPages([first, second], 3).recognized).toHaveLength(2);
  });
  it('exports partial and repeated results from original without duplicate layers', async () => {
    const doc = await PDFDocument.create();
    doc.setTitle('Untouched metadata');
    doc.addPage([300, 400]);
    doc.addPage([300, 400]).drawText('NATIVE', { x: 20, y: 200 });
    const original = (await doc.save()).slice().buffer;
    const baseline = new Uint8Array(original).slice();
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    for (let i = 0; i < 2; i++) {
      const bytes = await exportOcrPages(original, [page(1)]);
      expect((await PDFDocument.load(bytes)).getTitle()).toBe('Untouched metadata');
      const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
      try {
        const output = await task.promise;
        expect(output.numPages).toBe(2);
        const text = await (await output.getPage(1)).getTextContent();
        expect(text.items.filter(item => 'str' in item && item.str === 'CHECKPOINT')).toHaveLength(1);
        const second = await (await output.getPage(2)).getTextContent();
        expect(second.items.filter(item => 'str' in item).map(item => item.str).join('')).toBe('NATIVE');
      } finally { await task.destroy(); }
    }
    expect(new Uint8Array(original)).toEqual(baseline);
  });
});
