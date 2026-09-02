import { describe, expect, it } from 'vitest';
import { splitByTargetSize } from '@/lib/pageRange';

describe('splitByTargetSize', () => {
  it('returns single chunk when maxBytes is larger than totalBytes', () => {
    const parts = splitByTargetSize(10, 10_000_000, 25_000_000);
    expect(parts).toEqual([{ from: 1, to: 10 }]);
  });

  it('splits pages evenly based on average byte sizes', () => {
    // 10 pages, 50 MB total -> 5 MB per page. Max 15 MB per part -> 3 pages per part
    const totalBytes = 50 * 1024 * 1024;
    const maxBytes = 15 * 1024 * 1024;
    const parts = splitByTargetSize(10, totalBytes, maxBytes);

    expect(parts).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 6 },
      { from: 7, to: 9 },
      { from: 10, to: 10 },
    ]);
  });

  it('respects variable page sizes when provided', () => {
    // 4 pages with varying sizes: 2MB, 8MB, 4MB, 7MB. Max 10 MB per part
    const pageSizes = [2_000_000, 8_000_000, 4_000_000, 7_000_000];
    const totalBytes = 21_000_000;
    const maxBytes = 10_000_000;

    const parts = splitByTargetSize(4, totalBytes, maxBytes, pageSizes);
    expect(parts).toEqual([
      { from: 1, to: 2 }, // 2MB + 8MB = 10MB
      { from: 3, to: 3 }, // 4MB (cannot add 7MB because 11MB > 10MB)
      { from: 4, to: 4 }, // 7MB
    ]);
  });
});
