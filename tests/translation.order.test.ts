import { expect, it } from 'vitest';
import { orderTranslationBlocks } from '@/lib/translation/order';
import type { TranslationBlock } from '@/lib/translation/layout';
const block = (id: string, x: number, y: number, width = 100): TranslationBlock => ({
  id, x, y, width, height: 10, source: id, translated: '', font: 'Helvetica', size: 12, lines: [], included: true,
});
it('reads clearly separated columns before the full-width footer, without changing IDs or content', () => {
  const blocks = [block('header', 10, 0, 580), ...[1, 2, 3].flatMap(i => [block(`l${i}`, 20, i * 20), block(`r${i}`, 350, i * 20)]), block('footer', 10, 100, 580)];
  const before = JSON.stringify(blocks);
  expect(orderTranslationBlocks(blocks, 600).map(b => b.id)).toEqual(['header', 'l1', 'l2', 'l3', 'r1', 'r2', 'r3', 'footer']);
  expect(JSON.stringify(blocks)).toBe(before);
});
it('does not infer columns from one caption or a single-column document', () => {
  const blocks = [block('a', 20, 10), block('b', 350, 20)];
  expect(orderTranslationBlocks(blocks, 600)).toBe(blocks);
});
