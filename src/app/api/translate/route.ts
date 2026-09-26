import { TranslationError, validateRequest } from '@/lib/translation/contracts';
import { readBounded, translateWithProvider } from '@/lib/translation/provider';

export const runtime = 'nodejs';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
// A per-instance concurrency brake, not a distributed rate limiter or authentication system.
let active = 0;
export async function POST(request: Request) {
  let entered = false;
  try {
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin ||
        request.headers.get('sec-fetch-site') === 'cross-site') throw new TranslationError('origin_rejected', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new TranslationError('invalid_request');
    const auth = request.headers.get('authorization') ?? '';
    if (!/^Bearer [\x21-\x7E]{10,2048}$/.test(auth)) throw new TranslationError('key_required', 401);
    // Never fall back to process.env.OPENAI_API_KEY: public visitors supply their OWN key.
    if (active >= 8) throw new TranslationError('busy', 429);
    active++; entered = true;
    let value: unknown;
    try { value = JSON.parse(await readBounded(request.body, 100_000)); }
    catch (error) { if (error instanceof TranslationError) throw error; throw new TranslationError('invalid_request'); }
    const input = validateRequest(value);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(100_000)]);
    const translations = await translateWithProvider(input, auth.slice(7), signal,
      { allowedEndpoints: process.env.TRANSLATION_COMPATIBLE_BASE_URLS });
    return Response.json({ translations }, { headers });
  } catch (error) {
    // Never return or log provider bodies, key material, source text or arbitrary exception messages.
    const safe = error instanceof TranslationError ? error : new TranslationError('translation_failed', 500);
    return Response.json({ error: safe.code }, { status: safe.status, headers });
  } finally { if (entered) active--; }
}
