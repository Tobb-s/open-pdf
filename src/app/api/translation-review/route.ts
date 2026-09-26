import { TranslationError } from '@/lib/translation/contracts';
import { readBounded } from '@/lib/translation/provider';
import { MAX_REVIEW_BODY_BYTES, validateRegionReview } from '@/lib/translation/review-contract';
import { reviewRegionWithProvider } from '@/lib/translation/review-provider';
import { resolveCredential } from '@/lib/account/credential';
import { isSameOriginRequest } from '@/lib/http-origin';

export const runtime = 'nodejs';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
let active = 0;
export async function POST(request: Request) {
  let entered = false;
  try {
    if (!isSameOriginRequest(request)) throw new TranslationError('origin_rejected', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new TranslationError('invalid_request');
    // Independent per-instance brake. No shared development credential or automatic retry.
    if (active >= 4) throw new TranslationError('busy', 429);
    active++; entered = true;
    let value: unknown;
    try { value = JSON.parse(await readBounded(request.body, MAX_REVIEW_BODY_BYTES)); }
    catch (e) { if (e instanceof TranslationError) throw e; throw new TranslationError('invalid_request'); }
    const input = validateRegionReview(value);
    const apiKey = await resolveCredential(request, { provider: 'openai', model: input.model });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(100_000)]);
    return Response.json(await reviewRegionWithProvider(input, apiKey, signal), { headers });
  } catch (e) {
    const safe = e instanceof TranslationError ? e : new TranslationError('review_failed', 500);
    // No image, document text, keys, provider bodies or arbitrary exception messages in logs/responses.
    return Response.json({ error: safe.code }, { status: safe.status, headers });
  } finally { if (entered) active--; }
}
