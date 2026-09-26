import { describe, expect, it, vi, afterEach } from 'vitest';
import { AUTO_REVIEW_LIMIT, autoReviewCandidates, isDoubtfulBlock, reviewDecision, reviewDoubtfulBlocks } from '@/lib/translation/auto-review';
import { TranslationError } from '@/lib/translation/contracts';
import { pendingSegments, type TranslationBlock, type TranslationPage } from '@/lib/translation/layout';
import { requestRegionReview } from '@/lib/translation/review-client';

const block = (patch: Partial<TranslationBlock> = {}): TranslationBlock => ({ id: 'p1_b1', source: 'Econornic growth in 1983.',
  translated: '', included: true, confidence: 55, font: 'Helvetica', size: 12, x: 10, y: 10, width: 200, height: 30,
  lines: [{ x: 10, y: 10, width: 200, height: 30 }], ...patch });
const page = (blocks = [block()]): TranslationPage => ({ number: 1, width: 400, height: 400, method: 'ocr', warnings: [], blocks });
const signal = () => new AbortController().signal;
const reviewed = (patch: Partial<NonNullable<TranslationBlock['aiReview']>> = {}) => ({ original: 'Econornic growth in 1983.',
  source: 'Econornic growth in 1983.', model: 'gpt-6-luna', status: 'unresolved' as const, ...patch });
const options = () => ({ model: 'gpt-6-luna', provider: 'openai' as const, consent: true, signal: signal() });
const dependencies = () => ({ prepare: vi.fn().mockResolvedValue({ image: 'PNG-crop' }),
  request: vi.fn().mockResolvedValue({ text: 'Economic growth in 1983.', uncertain: false }), checkpoint: vi.fn(), progress: vi.fn() });
afterEach(() => vi.unstubAllGlobals());

describe('doubtful block selection and conservative automatic acceptance', () => {
  it.each([0, 59, 79.9])('selects OCR confidence %i', confidence => expect(isDoubtfulBlock(block({ confidence }))).toBe(true));
  it.each([80, 100, undefined, NaN])('does not confuse confidence %s with a doubt', confidence => expect(isDoubtfulBlock(block({ confidence }))).toBe(false));
  it.each(['[illegible]', '[ilegible: word]', 'bad\uFFFDglyph'])('also catches native text markers %s', source => {
    expect(isDoubtfulBlock(block({ confidence: undefined, source }))).toBe(true);
  });
  it('excludes unticked/translated/empty blocks and never recharges a completed review with the same source/model', () => {
    const blocks = [block(), block({ id: 'excluded', included: false }), block({ id: 'translated', translated: 'Mi edición.' }),
      block({ id: 'empty', source: '' }), block({ id: 'unresolved', aiReview: reviewed() }),
      block({ id: 'failed', aiReview: reviewed({ status: 'failed' }) }),
      block({ id: 'applied', source: 'Economic growth in 1983.', aiReview: reviewed({ source: 'Economic growth in 1983.', status: 'applied' }) })];
    expect(autoReviewCandidates([page(blocks)], 'gpt-6-luna').map(x => x.block.id)).toEqual(['p1_b1']);
    expect(autoReviewCandidates([page(blocks)], 'gpt-6-luna', true).map(x => x.block.id)).toEqual(['failed']);
    expect(autoReviewCandidates([page(blocks)], 'gpt-6-sol').map(x => x.block.id)).toEqual(['p1_b1', 'unresolved', 'failed', 'applied']);
  });
  it('allows a new explicit review after a source edit', () => {
    expect(autoReviewCandidates([page([block({ source: 'Changed [illegible]', aiReview: reviewed() })])], 'gpt-6-luna')).toHaveLength(1);
  });
  it('accepts a plain OCR correction without a human click', () => {
    expect(reviewDecision(block().source, { text: 'Economic growth in 1983.', uncertain: false }).reason).toBeUndefined();
  });
  it.each([
    ['Economic growth in 1985.', false, 'numbers_changed'],
    ['Economic growth in 1983. [illegible]', false, 'ambiguous'],
    ['Economic growth in 1983.', true, 'ambiguous'],
    ['Tiny', false, 'length_changed'],
    ['Economic growth in 1983. '.repeat(10), false, 'length_changed'],
  ])('retains suspicious proposal %s', (text, uncertain, reason) => {
    expect(reviewDecision(block().source, { text, uncertain }).reason).toBe(reason);
  });
  it('does not silently change mathematical operators', () => {
    expect(reviewDecision('Economic output Y = K + L', { text: 'Economic output Y < K + L', uncertain: false }).reason).toBe('symbols_changed');
  });
  it('rejects malformed results even if the model claims certainty', () => {
    expect(() => reviewDecision('Source', { text: '', uncertain: false })).toThrow('invalid_response');
  });
});
describe('bounded, cancellable, checkpointed visual review batch', () => {
  it('applies safe readings with session-only provenance, without changing geometry or an existing translation', async () => {
    const deps = dependencies(), original = block();
    await reviewDoubtfulBlocks([page([original, block({ id: 'translated', translated: 'Mi traducción.' })])], options(), deps);
    const updated = deps.checkpoint.mock.calls[0][1] as TranslationBlock;
    expect(deps.request).toHaveBeenCalledTimes(1);
    expect(deps.request.mock.calls[0][0]).toEqual({ model: 'gpt-6-luna', image: 'PNG-crop', sourceText: original.source });
    expect(updated.source).toBe('Economic growth in 1983.'); expect(updated.lines).toBe(original.lines);
    expect(updated.aiReview).toMatchObject({ original: original.source, status: 'applied' });
    expect(pendingSegments([page([updated])])).toEqual([{ id: original.id, text: updated.source }]);
    expect(original.aiReview).toBeUndefined();
  });
  it('keeps original OCR and exposes the proposal when numbers change', async () => {
    const deps = dependencies(); deps.request.mockResolvedValue({ text: 'Economic growth in 1985.', uncertain: false });
    await reviewDoubtfulBlocks([page()], options(), deps);
    expect(deps.checkpoint.mock.calls[0][1]).toMatchObject({ source: block().source,
      aiReview: { status: 'unresolved', reason: 'numbers_changed', proposal: 'Economic growth in 1985.' } });
  });
  it('sends at most twenty sequential calls; next click only picks untouched blocks', async () => {
    let pages = [page(Array.from({ length: 23 }, (_, i) => block({ id: `p1_b${i + 1}` })))];
    const deps = dependencies(); deps.checkpoint.mockImplementation((old, updated) => {
      pages = pages.map(p => ({ ...p, blocks: p.blocks.map(b => b.id === old.id ? updated : b) }));
    });
    await reviewDoubtfulBlocks(pages, options(), deps); expect(deps.request).toHaveBeenCalledTimes(AUTO_REVIEW_LIMIT);
    expect(autoReviewCandidates(pages, 'gpt-6-luna')).toHaveLength(3);
    await reviewDoubtfulBlocks(pages, options(), deps); expect(deps.request).toHaveBeenCalledTimes(23);
    expect(autoReviewCandidates(pages, 'gpt-6-luna')).toHaveLength(0);
  });
  it.each(['provider_auth', 'provider_quota', 'provider_error', 'provider_unreachable'])('stops the budget on %s and leaves prior successes', async code => {
    const deps = dependencies(); deps.request.mockResolvedValueOnce({ text: 'Economic growth in 1983.', uncertain: false })
      .mockRejectedValueOnce(new TranslationError(code));
    await expect(reviewDoubtfulBlocks([page([block(), block({ id: 'p1_b2' }), block({ id: 'p1_b3' })])], options(), deps)).rejects.toThrow(code);
    expect(deps.request).toHaveBeenCalledTimes(2); expect(deps.checkpoint).toHaveBeenCalledTimes(2);
    expect(deps.checkpoint.mock.calls[0][1].aiReview.status).toBe('applied');
    expect(deps.checkpoint.mock.calls[1][1].aiReview.status).toBe('failed');
  });
  it('continues past a locally invalid crop without sending it', async () => {
    const deps = dependencies(); deps.prepare.mockRejectedValueOnce(new TranslationError('invalid_region'));
    await reviewDoubtfulBlocks([page([block(), block({ id: 'p1_b2' })])], options(), deps);
    expect(deps.request).toHaveBeenCalledTimes(1); expect(deps.checkpoint).toHaveBeenCalledTimes(2);
  });
  it('discards a late response after cancellation', async () => {
    const abort = new AbortController(), deps = dependencies();
    deps.request.mockImplementation(async () => { abort.abort(); return { text: 'Economic growth in 1983.', uncertain: false }; });
    await expect(reviewDoubtfulBlocks([page()], { ...options(), signal: abort.signal }, deps)).rejects.toThrow();
    expect(deps.checkpoint).not.toHaveBeenCalled();
  });
  it.each([{ consent: false }, { provider: 'gemini' as const }, { model: '' }])('rejects unauthorized configuration %# before crop/network', async patch => {
    const deps = dependencies(); await expect(reviewDoubtfulBlocks([page()], { ...options(), ...patch }, deps)).rejects.toThrow();
    expect(deps.prepare).not.toHaveBeenCalled(); expect(deps.request).not.toHaveBeenCalled();
  });
});
describe('shared visual review client', () => {
  it('uses only the saved ID, never a decrypted key or provenance/context payload', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ text: 'Economic growth.', uncertain: false })); vi.stubGlobal('fetch', fetcher);
    await requestRegionReview({ model: 'gpt-6-luna', image: 'crop', sourceText: 'Source' }, { apiKey: '', savedProviderId: 'f0788787-5f6a-4d8e-9f63-3368d18d20f5' }, signal());
    const [, init] = fetcher.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined(); expect(init.headers['X-OpenPDF-Provider']).toBeDefined();
    expect(JSON.parse(init.body)).toEqual({ model: 'gpt-6-luna', image: 'crop', sourceText: 'Source', consent: true });
    expect(init.cache).toBe('no-store');
  });
  it('does not call the API when already cancelled', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const abort = new AbortController(); abort.abort();
    await expect(requestRegionReview({ model: 'gpt-6-luna', image: 'crop', sourceText: 'Source' }, { apiKey: 'not-real' }, abort.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
