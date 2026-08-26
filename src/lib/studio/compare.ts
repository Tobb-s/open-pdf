import { diffWordsWithSpace } from 'diff';
import { visualHashSimilarity } from '@/lib/studio/visualCompare';

export type ComparisonStatus = 'unchanged' | 'modified' | 'moved' | 'added' | 'removed';

export interface ComparisonPage {
  page: number;
  text: string;
  visualHash?: string;
}

export interface WordChange {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

export interface PageDifference {
  id: string;
  status: ComparisonStatus;
  basePage: number | null;
  comparisonPage: number | null;
  similarity: number;
  visualSimilarity: number | null;
  moved: boolean;
  addedWords: number;
  removedWords: number;
  changes: readonly WordChange[];
}

export interface ComparisonReport {
  createdAt: string;
  basePages: number;
  comparisonPages: number;
  summary: Record<ComparisonStatus, number>;
  differences: readonly PageDifference[];
}

const normalized = (text: string): string =>
  text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();

const words = (text: string): string[] =>
  normalized(text).match(/[\p{L}\p{N}_]+/gu) ?? [];

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

export function textSimilarity(left: string, right: string): number {
  const a = words(left);
  const b = words(right);
  if (a.length === 0 && b.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const word of a) counts.set(word, (counts.get(word) ?? 0) + 1);
  let intersection = 0;
  for (const word of b) {
    const available = counts.get(word) ?? 0;
    if (available > 0) {
      intersection += 1;
      counts.set(word, available - 1);
    }
  }
  return intersection / Math.max(a.length, b.length, 1);
}

const changesBetween = (left: string, right: string): {
  changes: WordChange[];
  addedWords: number;
  removedWords: number;
} => {
  const changes = diffWordsWithSpace(left, right).map((change) => ({
    kind: change.added ? 'added' as const : change.removed ? 'removed' as const : 'same' as const,
    text: change.value,
  }));
  return {
    changes,
    addedWords: changes
      .filter((change) => change.kind === 'added')
      .reduce((count, change) => count + wordCount(change.text), 0),
    removedWords: changes
      .filter((change) => change.kind === 'removed')
      .reduce((count, change) => count + wordCount(change.text), 0),
  };
};

type Pair = {
  base: number;
  comparison: number;
  similarity: number;
  textExact: boolean;
  visualSimilarity: number | null;
};

const textExact = (left: ComparisonPage, right: ComparisonPage): boolean => {
  const a = normalized(left.text);
  const b = normalized(right.text);
  if (a !== '' || b !== '') return a === b;
  const visual = visualHashSimilarity(left.visualHash, right.visualHash);
  return visual === null ? a === b : visual >= 0.98;
};

const combinedSimilarity = (left: ComparisonPage, right: ComparisonPage): number => {
  const text = textSimilarity(left.text, right.text);
  const visual = visualHashSimilarity(left.visualHash, right.visualHash);
  const hasText = normalized(left.text) !== '' || normalized(right.text) !== '';
  if (visual === null) return text;
  if (!hasText) return visual;
  return text * 0.9 + visual * 0.1;
};

/** Builds a deterministic page map and word-level report for two PDF text extractions. */
export function comparePageText(
  base: readonly ComparisonPage[],
  comparison: readonly ComparisonPage[],
  createdAt = new Date().toISOString()
): ComparisonReport {
  const unmatchedBase = new Set(base.map((_, index) => index));
  const unmatchedComparison = new Set(comparison.map((_, index) => index));
  const pairs: Pair[] = [];

  const pair = (baseIndex: number, comparisonIndex: number, similarity: number, exact: boolean) => {
    pairs.push({
      base: baseIndex,
      comparison: comparisonIndex,
      similarity,
      textExact: exact,
      visualSimilarity: visualHashSimilarity(base[baseIndex].visualHash, comparison[comparisonIndex].visualHash),
    });
    unmatchedBase.delete(baseIndex);
    unmatchedComparison.delete(comparisonIndex);
  };

  const sharedLength = Math.min(base.length, comparison.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (textExact(base[index], comparison[index])) pair(index, index, 1, true);
  }

  for (const baseIndex of [...unmatchedBase]) {
    const exact = [...unmatchedComparison].find(
      (comparisonIndex) => textExact(base[baseIndex], comparison[comparisonIndex])
    );
    if (exact !== undefined) pair(baseIndex, exact, 1, true);
  }

  const candidates = [...unmatchedBase].flatMap((baseIndex) =>
    [...unmatchedComparison].map((comparisonIndex) => ({
      base: baseIndex,
      comparison: comparisonIndex,
      similarity: combinedSimilarity(base[baseIndex], comparison[comparisonIndex]),
      exact: false,
    }))
  );
  candidates.sort(
    (a, b) =>
      b.similarity - a.similarity ||
      Math.abs(a.base - a.comparison) - Math.abs(b.base - b.comparison) ||
      a.base - b.base
  );
  for (const candidate of candidates) {
    if (candidate.similarity < 0.18) break;
    if (!unmatchedBase.has(candidate.base) || !unmatchedComparison.has(candidate.comparison)) continue;
    pair(candidate.base, candidate.comparison, candidate.similarity, false);
  }

  const differences: PageDifference[] = pairs.map((entry) => {
    const basePage = base[entry.base];
    const comparisonPage = comparison[entry.comparison];
    const moved = entry.base !== entry.comparison;
    const visuallySame = entry.visualSimilarity === null || entry.visualSimilarity >= 0.94;
    const status: ComparisonStatus = entry.textExact
      ? moved
        ? 'moved'
        : visuallySame
          ? 'unchanged'
          : 'modified'
      : 'modified';
    const detail = changesBetween(basePage.text, comparisonPage.text);
    return {
      id: `pair-${entry.base}-${entry.comparison}`,
      status,
      basePage: basePage.page,
      comparisonPage: comparisonPage.page,
      similarity: entry.similarity,
      visualSimilarity: entry.visualSimilarity,
      moved,
      ...detail,
    };
  });

  for (const baseIndex of unmatchedBase) {
    const page = base[baseIndex];
    differences.push({
      id: `removed-${baseIndex}`,
      status: 'removed',
      basePage: page.page,
      comparisonPage: null,
      similarity: 0,
      visualSimilarity: null,
      moved: false,
      addedWords: 0,
      removedWords: wordCount(page.text),
      changes: [{ kind: 'removed', text: page.text }],
    });
  }
  for (const comparisonIndex of unmatchedComparison) {
    const page = comparison[comparisonIndex];
    differences.push({
      id: `added-${comparisonIndex}`,
      status: 'added',
      basePage: null,
      comparisonPage: page.page,
      similarity: 0,
      visualSimilarity: null,
      moved: false,
      addedWords: wordCount(page.text),
      removedWords: 0,
      changes: [{ kind: 'added', text: page.text }],
    });
  }

  differences.sort((a, b) => {
    const aPosition = a.comparisonPage ?? a.basePage ?? Number.MAX_SAFE_INTEGER;
    const bPosition = b.comparisonPage ?? b.basePage ?? Number.MAX_SAFE_INTEGER;
    return aPosition - bPosition || (a.basePage ?? 0) - (b.basePage ?? 0);
  });

  const summary: Record<ComparisonStatus, number> = {
    unchanged: 0,
    modified: 0,
    moved: 0,
    added: 0,
    removed: 0,
  };
  for (const difference of differences) summary[difference.status] += 1;

  return {
    createdAt,
    basePages: base.length,
    comparisonPages: comparison.length,
    summary,
    differences,
  };
}
