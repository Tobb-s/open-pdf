import { TranslationError, type TranslationProvider } from './contracts';
import type { TranslationBlock, TranslationPage } from './layout';
import { validateRegionResult, type RegionReviewResult } from './review-contract';

export const AUTO_REVIEW_LIMIT = 20;
const illegible = /\uFFFD|\[(?:illegible|ilegible|unreadable)[^\]]*\]/i;
export function isDoubtfulBlock(block: TranslationBlock) {
  return (block.confidence !== undefined && Number.isFinite(block.confidence) && block.confidence < 80) || illegible.test(block.source);
}
export function autoReviewCandidates(pages: TranslationPage[], model: string, retryFailed = false) {
  return pages.flatMap(page => page.blocks.filter(block => {
    if (!block.included || block.translated.trim() || !block.source.trim() || !isDoubtfulBlock(block)) return false;
    const previous = block.aiReview;
    if (retryFailed) return previous?.status === 'failed' && previous.source === block.source && previous.model === model.trim();
    return !previous || previous.source !== block.source || previous.model !== model.trim();
  }).map(block => ({ page, block })));
}

/** Heuristic brakes, not proof of correctness or a calibrated AI confidence score. */
export function reviewDecision(original: string, raw: RegionReviewResult) {
  const result = validateRegionResult(raw);
  if (result.uncertain || illegible.test(result.text)) return { ...result, reason: 'ambiguous' };
  const compact = (text: string) => text.replace(/\s+/g, ' ').trim();
  const before = compact(original), after = compact(result.text);
  if ((before.length >= 20 && after.length < before.length * .5) || after.length > before.length * 1.8 + 40) {
    return { ...result, reason: 'length_changed' };
  }
  const numbers = (text: string) => (text.normalize('NFKC').match(/\d+(?:[.,]\d+)*/g) ?? []).join('|');
  if (numbers(before) !== numbers(after)) return { ...result, reason: 'numbers_changed' };
  const symbols = (text: string) => (text.match(/[=<>≤≥±×÷∑∫√]/gu) ?? []).join('');
  if (symbols(before) !== symbols(after)) return { ...result, reason: 'symbols_changed' };
  return { ...result, reason: undefined };
}

export async function reviewDoubtfulBlocks(pages: TranslationPage[], options: {
  provider: TranslationProvider; model: string; consent: boolean; signal: AbortSignal; retryFailed?: boolean;
}, dependencies: {
  prepare: (page: TranslationPage, block: TranslationBlock, signal: AbortSignal) => Promise<{ image: string }>;
  request: (input: { model: string; image: string; sourceText: string }, signal: AbortSignal) => Promise<RegionReviewResult>;
  checkpoint: (original: TranslationBlock, updated: TranslationBlock) => void;
  progress?: (done: number, total: number) => void;
}) {
  if (!options.consent) throw new TranslationError('consent_required');
  if (options.provider !== 'openai' || !/^[\w./:-]{1,120}$/.test(options.model.trim())) throw new TranslationError('invalid_request');
  const candidates = autoReviewCandidates(pages, options.model, options.retryFailed).slice(0, AUTO_REVIEW_LIMIT);
  for (let i = 0; i < candidates.length; i++) {
    options.signal.throwIfAborted();
    const { page, block } = candidates[i];
    dependencies.progress?.(i + 1, candidates.length);
    let updated: TranslationBlock;
    try {
      const crop = await dependencies.prepare(page, block, options.signal);
      options.signal.throwIfAborted();
      const result = reviewDecision(block.source, await dependencies.request({ model: options.model.trim(),
        image: crop.image, sourceText: block.source }, options.signal));
      options.signal.throwIfAborted();
      const applied = !result.reason;
      updated = { ...block, source: applied ? result.text : block.source, aiReview: {
        original: block.source, source: applied ? result.text : block.source, proposal: result.text,
        model: options.model.trim(), status: applied ? 'applied' : 'unresolved', reason: result.reason,
      } };
    } catch (e) {
      options.signal.throwIfAborted();
      const reason = e instanceof TranslationError ? e.code : 'review_failed';
      updated = { ...block, aiReview: { original: block.source, source: block.source,
        model: options.model.trim(), status: 'failed', reason } };
      dependencies.checkpoint(block, updated);
      // Do not burn the rest of the budget on a bad key, quota, model or network.
      if (!['invalid_region', 'invalid_response'].includes(reason)) throw new TranslationError(reason);
      continue;
    }
    dependencies.checkpoint(block, updated);
  }
}
