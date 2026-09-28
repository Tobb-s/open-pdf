import { TranslationError } from './contracts';

export const MAX_ANALYSIS_PAGES = 100;
export type TranslationScope = { mode: 'all' } | { mode: 'range'; from: number; to: number };

/** Physical, one-based source pages; the upper bound is inclusive. */
export function selectedPageNumbers(total: number, scope: TranslationScope): number[] {
  const from = scope.mode === 'all' ? 1 : scope.from;
  const to = scope.mode === 'all' ? total : scope.to;
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
      from < 1 || to < from || to > total) throw new TranslationError('invalid_request');
  if (to - from + 1 > MAX_ANALYSIS_PAGES) throw new TranslationError('too_many_pages');
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export function contiguousSelectedPages(pages: { number: number }[], max = MAX_ANALYSIS_PAGES): boolean {
  return pages.length > 0 && pages.length <= max && pages.every((page, index) =>
    Number.isSafeInteger(page.number) && page.number >= 1 && (index === 0 || page.number === pages[index - 1].number + 1));
}
