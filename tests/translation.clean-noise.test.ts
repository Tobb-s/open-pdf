import { describe, expect, it, vi } from 'vitest';
import { validateRegionReview, validateRegionResult } from '@/lib/translation/review-contract';
import { reviewRegionWithProvider } from '@/lib/translation/review-provider';
import { cleanMarginCandidate } from '@/lib/translation/clean-verification';
import type { CleanElement } from '@/lib/translation/clean-contract';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XkAAAAASUVORK5CYII=';
const request = { model: 'gpt-6-luna', sourceText: 'Worksheet margin label', image, consent: true as const, task: 'classify_noise' as const };
describe('bounded AI review of uncertain page furniture', () => {
  it('allows only the explicit classification task and requires consent', () => {
    expect(validateRegionReview(request)).toEqual(request);
    expect(() => validateRegionReview({ ...request, task: 'delete_content' })).toThrow('invalid_request');
    expect(() => validateRegionReview({ ...request, consent: false })).toThrow('consent_required');
  });
  it('requires an unambiguous noise category, not just a transcription', () => {
    expect(validateRegionResult({ text: 'chart stamp', noiseReason: 'scan_mark', uncertain: false }, request.task)).toMatchObject({ noiseReason: 'scan_mark' });
    expect(validateRegionResult({ text: 'Genuine footnote', noiseReason: 'none', uncertain: true }, request.task).uncertain).toBe(true);
    for (const value of [{ text: 'chart stamp', uncertain: false }, { text: 'stamp', noiseReason: 'scan_mark', uncertain: true },
      { text: 'WPS 1807', noiseReason: 'scan_mark', uncertain: false }]) expect(() => validateRegionResult(value, request.task)).toThrow('invalid_response');
  });
  it('does not classify ordinary body notes by margin geometry alone', () => {
    const note: CleanElement = { kind: 'note', text: 'A note', ids: [], box: { x: 20, y: 40, width: 120, height: 20 }, uncertain: true, noiseReason: 'none' };
    expect(cleanMarginCandidate(note)).toBe(true);
    expect(cleanMarginCandidate({ ...note, box: { ...note.box, y: 400 } })).toBe(false);
    expect(cleanMarginCandidate({ ...note, kind: 'paragraph' })).toBe(false);
  });
  it('uses strict classification schema without storage or tools and preserves the normal transcription contract', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ text: 'chart stamp', noiseReason: 'scan_mark', uncertain: false }) }] }] }));
    expect(await reviewRegionWithProvider(request, 'synthetic', new AbortController().signal, fetcher)).toMatchObject({ noiseReason: 'scan_mark' });
    expect(fetcher).toHaveBeenCalledTimes(1); const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.store).toBe(false); expect(body.tools).toBeUndefined(); expect(body.text.format.schema.required).toContain('noiseReason');
    expect(body.instructions).toContain('footnotes');
    expect(validateRegionResult({ text: 'Book content', uncertain: false, noiseReason: 'scan_mark' })).toEqual({ text: 'Book content', uncertain: false });
  });
  it('cannot erase a protected original identifier by returning a disguised stamp name', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ text: 'stamp', noiseReason: 'scan_mark', uncertain: false }) }] }] }));
    await expect(reviewRegionWithProvider({ ...request, sourceText: JSON.stringify({ targetText: 'WPS 1807' }) }, 'synthetic', new AbortController().signal, fetcher)).rejects.toThrow('invalid_response');
  });
});
