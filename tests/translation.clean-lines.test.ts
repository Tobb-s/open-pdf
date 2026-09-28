import { describe, it, expect } from 'vitest';
import { cleanReferences } from '@/lib/translation/clean-document';
import { groupRuns, type TranslationPage } from '@/lib/translation/layout';
import { cleanParagraphText } from '@/lib/translation/clean-text';
const page = (): TranslationPage => ({ number: 1, width: 400, height: 400, method: 'ocr', warnings: [], blocks: [{
  id: 'p1_b1', source: 'Lead-in paragraph. Table caption.', translated: '', included: true, font: 'Helvetica', size: 12,
  x: 20, y: 20, width: 200, height: 50, lines: [{ x: 20, y: 20, width: 200, height: 12 }, { x: 20, y: 50, width: 100, height: 12 }],
  lineTexts: ['Lead-in paragraph.', 'Table caption.'],
}] });
describe('clean OCR line provenance', () => {
  it('unwraps physical text lines without removing real paragraph separations', () => {
    expect(cleanParagraphText('Primera línea\ncontinúa.\n\nOtro párrafo\r\ncontinúa.')).toBe('Primera línea continúa.\n\nOtro párrafo continúa.');
  });
  it('makes merged prose and captions separately accountable without changing the original', () => {
    const p = page(), copy = structuredClone(p), refs = cleanReferences(p);
    expect(refs.map(b => b.id)).toEqual(['p1_b1_l1', 'p1_b1_l2']); expect(refs.map(b => b.text)).toEqual(p.blocks[0].lineTexts);
    expect(refs[1].y).toBe(125); expect(p).toEqual(copy);
  });
  it('never substitutes old recognized lines for user-edited source', () => {
    const p = page(); p.blocks[0].source = 'User correction.';
    expect(cleanReferences(p)).toMatchObject([{ id: 'p1_b1', text: 'User correction.' }]);
  });
  it('preserves legacy and native block references', () => {
    const p = page(); p.method = 'native'; expect(cleanReferences(p)[0].id).toBe('p1_b1');
    p.method = 'ocr'; p.blocks[0].lineTexts = undefined; expect(cleanReferences(p)[0].id).toBe('p1_b1');
  });
  it('accounts for the actual hyphenated join used by OCR grouping', () => {
    const p = page(); p.blocks[0].source = 'Long-\nterm growth'; p.blocks[0].lineTexts = ['Long-', 'term growth'];
    expect(cleanReferences(p).map(b => b.text)).toEqual(['Long-', 'term growth']);
  });
  it('stores original line text when grouping runs, without altering normal paragraph output', () => {
    const runs = [{ text: 'Long-', x: 20, y: 20, width: 100, height: 10, size: 10, font: 'Helvetica', line: 1 },
      { text: 'term growth', x: 20, y: 35, width: 100, height: 10, size: 10, font: 'Helvetica', line: 2 }];
    const blocks = groupRuns(runs, 1);
    expect(blocks[0].source).toBe('Long-\nterm growth'); expect(blocks[0].lineTexts).toEqual(['Long-', 'term growth']);
  });
});
