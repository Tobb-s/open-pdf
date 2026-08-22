import { describe, expect, it } from 'vitest';
import {
  parsePageRange,
  parsePageSet,
  splitIntoParts,
  summarizePages,
} from '@/lib/pageRange';

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

describe('splitIntoParts', () => {
  it('cuts a book into runs that cover every page exactly once', () => {
    for (const [pages, parts] of [
      [700, 2],
      [700, 4],
      [700, 6],
      [700, 8],
      [700, 10],
      [13, 4],
      [1, 1],
    ] as const) {
      const runs = splitIntoParts(pages, parts);
      expect(runs, `${pages} en ${parts}`).toHaveLength(Math.min(parts, pages));
      expect(runs[0].from, `${pages} en ${parts}`).toBe(1);
      expect(runs[runs.length - 1].to, `${pages} en ${parts}`).toBe(pages);
      // Contiguous, with no gap and no overlap.
      for (let index = 1; index < runs.length; index += 1) {
        expect(runs[index].from, `${pages} en ${parts}`).toBe(runs[index - 1].to + 1);
      }
      // Every run holds at least one page.
      for (const run of runs) expect(run.to).toBeGreaterThanOrEqual(run.from);
    }
  });

  it('spreads the remainder rather than forcing equal parts', () => {
    // 700 in 6 is 116.67: four runs of 117 and two of 116, longer ones first.
    const runs = splitIntoParts(700, 6);
    expect(runs.map((run) => run.to - run.from + 1)).toEqual([117, 117, 117, 117, 116, 116]);
  });

  it('never returns an empty part, however many are asked for', () => {
    expect(splitIntoParts(3, 10)).toEqual([
      { from: 1, to: 1 },
      { from: 2, to: 2 },
      { from: 3, to: 3 },
    ]);
  });

  it('refuses nonsense quietly', () => {
    expect(splitIntoParts(0, 4)).toEqual([]);
    expect(splitIntoParts(10, 0)).toEqual([]);
  });
});
