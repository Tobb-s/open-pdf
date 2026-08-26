import { describe, expect, it } from 'vitest';
import { visualHash, visualHashSimilarity } from '@/lib/studio/visualCompare';

const image = (left: number, right: number) => {
  const width = 18;
  const height = 8;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = x < width / 2 ? left : right;
      const offset = (y * width + x) * 4;
      data.set([value, value, value, 255], offset);
    }
  }
  return { data, width, height };
};

describe('visual page fingerprints', () => {
  it('is stable for the same visual pattern and distinguishes its inverse', () => {
    const darkToLight = visualHash(image(20, 230));
    expect(visualHash(image(20, 230))).toBe(darkToLight);
    expect(visualHashSimilarity(darkToLight, visualHash(image(230, 20)))).toBeLessThan(1);
  });

  it('returns no similarity for missing or incompatible hashes', () => {
    expect(visualHashSimilarity(undefined, '01')).toBeNull();
    expect(visualHashSimilarity('0', '01')).toBeNull();
  });
});
