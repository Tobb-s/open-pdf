import { describe, expect, it } from 'vitest';
import { fitWithin } from '@/lib/geometry';
import { idsForNumbers, numbersForIds } from '@/lib/studio/scope';

/**
 * Two small things in Studio that were wrong in visible ways.
 *
 * An image placed as a stamp was 140×140 whatever its shape, so a scanned
 * signature of 600×200 came out crushed into a square. And the watermark and
 * the numbering had a page scope in their spec that the panel never offered:
 * `pages` was hard-coded to null while the picker the other tools use sat in
 * StampControls, unconnected.
 */

describe('fitWithin', () => {
  it('keeps a wide image wide', () => {
    // A signature: three times wider than tall.
    expect(fitWithin(600, 200, 140)).toEqual({ width: 140, height: 140 / 3 });
  });

  it('keeps a tall image tall', () => {
    const { width, height } = fitWithin(200, 600, 140);
    expect(height).toBe(140);
    expect(width).toBeCloseTo(140 / 3);
  });

  it('fills the box with a square', () => {
    expect(fitWithin(300, 300, 140)).toEqual({ width: 140, height: 140 });
  });

  it('never makes the longest side larger than the box', () => {
    for (const [w, h] of [
      [1, 5000],
      [5000, 1],
      [7, 11],
    ]) {
      const fitted = fitWithin(w, h, 140);
      expect(Math.max(fitted.width, fitted.height)).toBeCloseTo(140);
    }
  });

  it('falls back to the square when the shape is not known', () => {
    // An image that would not decode at the moment of choosing is placed as it
    // always was; it fails to embed later with its own message.
    expect(fitWithin(0, 0, 140)).toEqual({ width: 140, height: 140 });
    expect(fitWithin(Number.NaN, 40, 140)).toEqual({ width: 140, height: 140 });
  });
});

describe('translating a scope between numbers and ids', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];

  it('maps positions to the ids at those positions', () => {
    expect(idsForNumbers([2, 5], ids)).toEqual(['b', 'e']);
  });

  it('drops a position past the end rather than inventing a page', () => {
    expect(idsForNumbers([1, 9], ids)).toEqual(['a']);
  });

  it('does not name the same page twice', () => {
    expect(idsForNumbers([3, 3], ids)).toEqual(['c']);
  });

  it('maps ids back to positions, ascending', () => {
    expect(numbersForIds(['e', 'b'], ids)).toEqual([2, 5]);
  });

  it('answers «every page» for null', () => {
    expect(numbersForIds(null, ids)).toEqual([1, 2, 3, 4, 5]);
  });

  it('drops an id whose page is gone', () => {
    expect(numbersForIds(['b', 'zz'], ids)).toEqual([2]);
  });

  it('THE POINT: a scope follows its pages through a reorder', () => {
    // The reader scoped the watermark to pages 2 and 5, then moved page 5 to
    // the front. The spec holds ids, so the same two pages are still the ones
    // stamped — and the picker now says 1 and 3, which is where they are.
    const scoped = idsForNumbers([2, 5], ids);
    const reordered = ['e', 'a', 'b', 'c', 'd'];
    expect(numbersForIds(scoped, reordered)).toEqual([1, 3]);
  });
});
