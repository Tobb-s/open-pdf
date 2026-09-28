import { describe, it, expect } from 'vitest';
import { cleanImageDimensions, normalizeCleanPage } from '@/lib/translation/clean-coordinates';
import { validateCleanResult, type CleanElement } from '@/lib/translation/clean-contract';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XkAAAAASUVORK5CYII=';
const pixel = (w: number, h: number) => {
  const data = Buffer.from(image.slice(22), 'base64'); data.writeUInt32BE(w, 16); data.writeUInt32BE(h, 20);
  return 'data:image/png;base64,' + data.toString('base64');
};
const element: CleanElement = { kind: 'figure', ids: [], text: '', box: { x: 160, y: 120, width: 800, height: 600 }, noiseReason: 'none', uncertain: false };
describe('explicit vision coordinates', () => {
  it('derives actual bounded landscape PNG dimensions', () => expect(cleanImageDimensions(pixel(1600, 1200))).toEqual({ width: 1600, height: 1200 }));
  it('converts declared pixels on each axis without mutating the response', () => {
    const raw = { coordinateSpace: 'image_pixels', elements: [element] };
    const copy = structuredClone(raw);
    expect(normalizeCleanPage(raw, pixel(1600, 1200)).elements[0].box).toEqual({ x: 100, y: 100, width: 500, height: 500 });
    expect(raw).toEqual(copy);
  });
  it('never guesses pixels for a normalized or legacy response', () => {
    for (const mode of [undefined, 'normalized_1000']) {
      const raw = { coordinateSpace: mode, elements: [{ ...element, box: { ...element.box, width: 1500 } }] };
      expect(() => validateCleanResult(normalizeCleanPage(raw, pixel(1600, 1200)), [])).toThrow('invalid_response');
    }
  });
  it('rejects undeclared coordinate conventions and out-of-image pixels', () => {
    expect(() => normalizeCleanPage({ coordinateSpace: 'pdf_points', elements: [element] }, image)).toThrow('invalid_response');
    expect(() => validateCleanResult(normalizeCleanPage({ coordinateSpace: 'image_pixels', elements: [element] }, image), [])).toThrow('invalid_response');
  });
  it('retains uncertain noise as a note requiring review, never as an exclusion', () => {
    const note = { ...element, kind: 'noise', text: 'Ambiguous mark', box: { x: 10, y: 10, width: 50, height: 50 }, noiseReason: 'scan_mark', uncertain: true };
    const result = normalizeCleanPage({ elements: [note] }, image);
    expect(validateCleanResult(result, [])[0]).toMatchObject({ kind: 'note', noiseReason: 'none', uncertain: true, text: 'Ambiguous mark' });
  });
});
