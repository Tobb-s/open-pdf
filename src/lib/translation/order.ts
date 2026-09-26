import type { TranslationBlock } from './layout';

/** Conservative two-column ordering, separated into bands by full-width blocks.
 * Only activate with repeated evidence on both sides of a clear central gutter. */
export function orderTranslationBlocks(blocks: TranslationBlock[], width: number): TranslationBlock[] {
  const edges = [...new Set(blocks.flatMap(b => [b.x, b.x + b.width]))]
    .filter(x => x > width * .35 && x < width * .65).sort((a, b) => a - b);
  const candidates = [width / 2, ...edges.flatMap((x, i) => i && x - edges[i - 1] >= 16 ? [(x + edges[i - 1]) / 2] : [])];
  const evidence = (center: number) => blocks.filter(b => b.x + b.width <= center - 8 || b.x >= center + 8).length;
  const middle = candidates.sort((a, b) => evidence(b) - evidence(a))[0];
  const left = (b: TranslationBlock) => b.x + b.width <= middle - 8;
  const right = (b: TranslationBlock) => b.x >= middle + 8;
  if (blocks.filter(left).length < 3 || blocks.filter(right).length < 3) return blocks;
  const result: TranslationBlock[] = [], band: TranslationBlock[] = [];
  const flush = () => {
    if (band.filter(left).length >= 3 && band.filter(right).length >= 3) {
      result.push(...band.filter(left).sort((a, b) => a.y - b.y), ...band.filter(right).sort((a, b) => a.y - b.y));
    } else result.push(...band.sort((a, b) => a.y - b.y || a.x - b.x));
    band.length = 0;
  };
  for (const block of [...blocks].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (left(block) || right(block)) band.push(block);
    else { flush(); result.push(block); }
  }
  flush();
  return result;
}
