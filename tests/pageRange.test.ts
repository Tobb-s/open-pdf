import { describe, expect, it } from 'vitest';
import { parsePageRange, parsePageSet, summarizePages } from '@/lib/pageRange';

describe('parsePageRange', () => {
  it('reads single pages and ranges', () => {
    expect(parsePageRange('1-3, 5', 10).pages).toEqual([1, 2, 3, 5]);
  });

  it('keeps the order the reader typed', () => {
    // Sorting the result made "3, 1" silently mean "1, 3", so pages could not be
    // reordered while extracting.
    expect(parsePageRange('3, 1', 10).pages).toEqual([3, 1]);
  });

  it('counts backwards through a descending range', () => {
    expect(parsePageRange('5-2', 10).pages).toEqual([5, 4, 3, 2]);
  });

  it('treats an open end as the edge of the document', () => {
    expect(parsePageRange('8-', 10).pages).toEqual([8, 9, 10]);
    expect(parsePageRange('-3', 10).pages).toEqual([1, 2, 3]);
  });

  it('clamps a range that overshoots', () => {
    expect(parsePageRange('8-999', 10).pages).toEqual([8, 9, 10]);
  });

  it('allows a page to be repeated', () => {
    expect(parsePageRange('1, 1, 2', 10).pages).toEqual([1, 1, 2]);
  });

  it('reports what it could not read instead of dropping it', () => {
    const result = parsePageRange('1, banana, 99, -', 10);
    expect(result.pages).toEqual([1]);
    expect(result.invalid).toEqual(['banana', '99', '-']);
  });

  it('ignores stray whitespace and empty entries', () => {
    expect(parsePageRange('  1 , , 2 - 3  ', 10).pages).toEqual([1, 2, 3]);
    expect(parsePageRange('', 10)).toEqual({ pages: [], invalid: [] });
  });

  it('returns nothing for an empty document', () => {
    expect(parsePageRange('1-3', 0).pages).toEqual([]);
  });
});

describe('summarizePages', () => {
  it('collapses runs back into ranges', () => {
    expect(summarizePages([1, 2, 3, 7, 9, 10])).toBe('1-3, 7, 9-10');
  });

  it('handles a single page and an empty selection', () => {
    expect(summarizePages([4])).toBe('4');
    expect(summarizePages([])).toBe('');
  });
});

describe('parsePageSet', () => {
  it('sorts and drops repeats, so nothing gets stamped twice', () => {
    // parsePageRange keeps order and repeats on purpose — that is what splitting
    // needs. Stamping needs the opposite: `3, 1, 3` is three pages to a splitter
    // and two pages to a watermark, at single opacity.
    expect(parsePageSet('3, 1, 3', 10).pages).toEqual([1, 3]);
    expect(parsePageSet('5-1', 10).pages).toEqual([1, 2, 3, 4, 5]);
  });

  it('still reports what it could not read', () => {
    const result = parsePageSet('2, tres, 4', 10);
    expect(result.pages).toEqual([2, 4]);
    expect(result.invalid).toEqual(['tres']);
  });
});
