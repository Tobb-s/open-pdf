import { isSameOriginRequest } from '@/lib/http-origin';
import { resolveCredential } from '@/lib/account/credential';
import { TranslationError } from '@/lib/translation/contracts';
import { readBounded } from '@/lib/translation/provider';
import { parseModels } from '@/lib/openai/models';

export const runtime = 'nodejs';
export const maxDuration = 30;
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
let active = 0;
export async function POST(request: Request) {
  let entered = false;
  try {
    if (!isSameOriginRequest(request)) throw new TranslationError('origin_rejected', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new TranslationError('invalid_request');
    let input;
    try { input = JSON.parse(await readBounded(request.body, 100)); }
    catch (e) { if (e instanceof TranslationError) throw e; throw new TranslationError('invalid_request'); }
    if (input?.provider !== 'openai') throw new TranslationError('invalid_request');
    if (active >= 4) throw new TranslationError('busy', 429);
    active++; entered = true;
    const key = await resolveCredential(request, { provider: 'openai', model: '' });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
    let response;
    try {
      response = await fetch('https://api.openai.com/v1/models', { redirect: 'error', cache: 'no-store', signal,
        headers: { Authorization: `Bearer ${key}` } });
    } catch { throw new TranslationError(signal.aborted ? 'cancelled_or_timeout' : 'provider_unreachable', 502); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new TranslationError([401, 403].includes(response.status) ? 'provider_auth'
        : response.status === 429 ? 'provider_quota' : 'provider_error', 502);
    }
    const models = parseModels(JSON.parse(await readBounded(response.body, 1_000_000)));
    return Response.json({ models }, { headers });
  } catch (e) {
    const safe = e instanceof TranslationError ? e : new TranslationError('invalid_response', 502);
    return Response.json({ error: safe.code }, { status: safe.status, headers });
  } finally { if (entered) active--; }
}
