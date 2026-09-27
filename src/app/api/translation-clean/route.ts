import { TranslationError } from '@/lib/translation/contracts';
import { readBounded } from '@/lib/translation/provider';
import { validateCleanRequest } from '@/lib/translation/clean-contract';
import { cleanWithProvider } from '@/lib/translation/clean-provider';
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
    if (active >= 4) throw new TranslationError('busy', 429);
    active++; entered = true;
    let value;
    try { value = JSON.parse(await readBounded(request.body, 2100000)); }
    catch (e) { if (e instanceof TranslationError) throw e; throw new TranslationError('invalid_request'); }
    const input = validateCleanRequest(value);
    const key = await resolveCredential(request, { provider: 'openai', model: input.model });
    const elements = await cleanWithProvider(input, key, AbortSignal.any([request.signal, AbortSignal.timeout(100000)]));
    return Response.json({ elements }, { headers });
  } catch (e) {
    const safe = e instanceof TranslationError ? e : new TranslationError('review_failed', 500);
    return Response.json({ error: safe.code }, { status: safe.status, headers });
  } finally { if (entered) active--; }
}
