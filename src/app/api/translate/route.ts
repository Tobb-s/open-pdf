import { TranslationError, validateRequest } from '@/lib/translation/contracts';
import { readBounded, translateWithProvider } from '@/lib/translation/provider';
import { resolveCredential } from '@/lib/account/credential';
import { isSameOriginRequest } from '@/lib/http-origin';

export const runtime = 'nodejs';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
// A per-instance concurrency brake, not a distributed rate limiter or authentication system.
let active = 0;
export async function POST(request: Request) {
  let entered = false;
  try {
    if (!isSameOriginRequest(request)) throw new TranslationError('origin_rejected', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new TranslationError('invalid_request');
    // Never fall back to process.env.OPENAI_API_KEY: public visitors supply their OWN key.
    if (active >= 8) throw new TranslationError('busy', 429);
    active++; entered = true;
    let value: unknown;
    try { value = JSON.parse(await readBounded(request.body, 100_000)); }
    catch (error) { if (error instanceof TranslationError) throw error; throw new TranslationError('invalid_request'); }
    const input = validateRequest(value);
    const apiKey = await resolveCredential(request, input);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(100_000)]);
    const translations = await translateWithProvider(input, apiKey, signal,
      { allowedEndpoints: process.env.TRANSLATION_COMPATIBLE_BASE_URLS });
    const received = new Set(translations.map(s => s.id));
    const missingIds = input.segments.filter(s => !received.has(s.id)).map(s => s.id);
    return Response.json({ translations, ...(missingIds.length ? { missingIds } : {}) }, { headers });
  } catch (error) {
    // Never return or log provider bodies, key material, source text or arbitrary exception messages.
    const safe = error instanceof TranslationError ? error : new TranslationError('translation_failed', 500);
    return Response.json({ error: safe.code }, { status: safe.status, headers });
  } finally { if (entered) active--; }
}
