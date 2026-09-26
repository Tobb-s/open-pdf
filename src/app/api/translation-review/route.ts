import { TranslationError } from '@/lib/translation/contracts';
import { readBounded } from '@/lib/translation/provider';
import { MAX_REVIEW_BODY_BYTES, validateRegionReview } from '@/lib/translation/review-contract';
import { reviewRegionWithProvider } from '@/lib/translation/review-provider';

export const runtime = 'nodejs';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
let active = 0;
export async function POST(request: Request) {
  let entered = false;
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin ||
        request.headers.get('sec-fetch-site') === 'cross-site') throw new TranslationError('origin_rejected', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new TranslationError('invalid_request');
    const auth = request.headers.get('authorization') ?? '';
    if (!/^Bearer [\x21-\x7E]{10,2048}$/.test(auth)) throw new TranslationError('key_required', 401);
    // Independent per-instance brake. No shared development credential or automatic retry.
    if (active >= 4) throw new TranslationError('busy', 429);
    active++; entered = true;
    let value: unknown;
    try { value = JSON.parse(await readBounded(request.body, MAX_REVIEW_BODY_BYTES)); }
    catch (e) { if (e instanceof TranslationError) throw e; throw new TranslationError('invalid_request'); }
    const input = validateRegionReview(value);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(100_000)]);
    return Response.json(await reviewRegionWithProvider(input, auth.slice(7), signal), { headers });
  } catch (e) {
    const safe = e instanceof TranslationError ? e : new TranslationError('review_failed', 500);
    // No image, document text, keys, provider bodies or arbitrary exception messages in logs/responses.
    return Response.json({ error: safe.code }, { status: safe.status, headers });
  } finally { if (entered) active--; }
}
