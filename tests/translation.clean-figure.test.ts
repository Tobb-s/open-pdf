import { describe, it, expect } from 'vitest';
import { figureSearchBox } from '@/lib/translation/clean-figure';
import type { CleanPage } from '@/lib/translation/clean-contract';
const page = (): CleanPage => ({ number: 1, width: 614, height: 798,
  elements: [{ kind: 'figure', ids: ['table'], text: '', translated: '', uncertain: false, noiseReason: 'none', box: { x: 174, y: 233, width: 576, height: 131 } }],
  reference: [{ id: 'table', text: 'Table labels', x: 175, y: 234, width: 575, height: 133 },
    { id: 'caption', text: 'Table caption', x: 211, y: 170, width: 510, height: 33 },
    { id: 'prose', text: 'Paragraph after the table', x: 174, y: 401, width: 705, height: 213 }] });
describe('figure search preserves neighbors', () => {
  it('includes assigned OCR ink but stops expansion before neighboring caption and paragraph', () => {
    const p = page(), copy = structuredClone(p), b = figureSearchBox(p, 0);
    expect(b.y).toBe(204); expect(b.y + b.height).toBe(400); expect(b.y + b.height).toBeGreaterThan(367);
    expect(p).toEqual(copy);
  });
  it('rejects an initial crop that already invades another paragraph', () => {
    const p = page(); p.elements[0].box.height = 200;
    expect(() => figureSearchBox(p, 0)).toThrow('clean_uncertain');
  });
  it('constrains expansion near rotated side captions without masking them', () => {
    const p = page(); p.reference.push({ id: 'side', text: 'Side caption', x: 790, y: 240, width: 20, height: 100 });
    const b = figureSearchBox(p, 0); expect(b.x + b.width).toBe(789);
  });
  it('rejects an ambiguous figure reaching the page edge, not silently clipping it', () => {
    const p = page(); p.elements[0].box.x = 0;
    expect(() => figureSearchBox(p, 0)).toThrow('clean_uncertain');
  });
  it('does not collect diagonal page furniture into the crop bounds', () => {
    const p = page(); p.reference.push({ id: 'date', text: '7/1/97', x: 120, y: 375, width: 20, height: 15 });
    expect(figureSearchBox(p, 0).x).toBe(141);
  });
});
