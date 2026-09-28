import { describe, expect, it } from 'vitest';
import { contiguousSelectedPages, MAX_ANALYSIS_PAGES, selectedPageNumbers } from '@/lib/translation/scope';

describe('translation source-page selection', () => {
  it('includes both ends of a later range and preserves physical numbering', () => {
    const pages = selectedPageNumbers(75, { mode: 'range', from: 20, to: 50 });
    expect(pages).toHaveLength(31);
    expect(pages[0]).toBe(20);
    expect(pages.at(-1)).toBe(50);
    expect(contiguousSelectedPages(pages.map(number => ({ number })))).toBe(true);
  });
  it('uses the entire PDF when within the technical cap', () => {
    expect(selectedPageNumbers(12, { mode: 'all' })).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(selectedPageNumbers(150, { mode: 'range', from: 51, to: 150 })).toHaveLength(MAX_ANALYSIS_PAGES);
  });
  it.each([
    [20, { mode: 'range', from: 0, to: 5 }],
    [20, { mode: 'range', from: 8, to: 7 }],
    [20, { mode: 'range', from: 1.5, to: 4 }],
    [20, { mode: 'range', from: 1, to: 21 }],
    [0, { mode: 'all' }],
  ] as const)('rejects invalid range %j %j', (total, scope) => {
    expect(() => selectedPageNumbers(total, scope)).toThrow();
  });
  it('rejects too many selected pages and gaps in analyzed pages', () => {
    expect(() => selectedPageNumbers(101, { mode: 'all' })).toThrow('too_many_pages');
    expect(contiguousSelectedPages([{ number: 20 }, { number: 22 }])).toBe(false);
    expect(contiguousSelectedPages([{ number: 0 }])).toBe(false);
  });
});
