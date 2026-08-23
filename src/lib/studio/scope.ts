import type { PageId } from '@/lib/studio/script';

/**
 * Between what the reader types and what the script stores.
 *
 * A watermark's or a numbering's scope is kept as page IDS, not numbers, so
 * that «pages 2 and 5» stays on those two pages when the reader reorders the
 * document: the numbers move, the pages do not. The picker, though, speaks
 * numbers — 1-based positions in the document as it is shown right now. These
 * two translate, always against the CURRENT order.
 */

/** 1-based positions → ids, in document order. Positions past the end are dropped. */
export function idsForNumbers(numbers: readonly number[], ids: readonly PageId[]): PageId[] {
  const out: PageId[] = [];
  for (const number of numbers) {
    const id = ids[number - 1];
    if (id !== undefined && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * ids → 1-based positions in the current order, ascending.
 *
 * `null` means every page, and is answered as such. An id that is no longer in
 * the document — its page was deleted — is dropped rather than invented.
 */
export function numbersForIds(wanted: readonly PageId[] | null, ids: readonly PageId[]): number[] {
  if (wanted === null) return ids.map((_, index) => index + 1);
  const out: number[] = [];
  for (const id of wanted) {
    const at = ids.indexOf(id);
    if (at !== -1 && !out.includes(at + 1)) out.push(at + 1);
  }
  return out.sort((a, b) => a - b);
}
