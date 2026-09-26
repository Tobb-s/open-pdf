import { requireAccount } from '@/lib/account/auth';
import { deleteProvider, saveProvider } from '@/lib/account/store';
import { isSavedProviderId, validateProvider } from '@/lib/account/contracts';
import { readBounded } from '@/lib/translation/provider';
import { TranslationError } from '@/lib/translation/contracts';
import { isSameOriginRequest } from '@/lib/http-origin';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
async function mutate(request: Request, remove: boolean) {
  try {
    if (!isSameOriginRequest(request)) {
      throw new TranslationError('origin_rejected', 403);
    }
    const user = await requireAccount();
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new TranslationError('invalid_request');
    let value;
    try { value = JSON.parse(await readBounded(request.body, 8_000)); }
    catch (e) { if (e instanceof TranslationError) throw e; throw new TranslationError('invalid_request'); }
    if (remove) {
      if (!isSavedProviderId(value?.id)) throw new TranslationError('invalid_request');
      await deleteProvider(user.ownerId, value.id);
      return new Response(null, { status: 204, headers });
    }
    return Response.json(await saveProvider(user.ownerId, validateProvider(value)), { status: 201, headers });
  } catch (e) {
    const safe = e instanceof TranslationError ? e : new TranslationError('account_unavailable', 503);
    return Response.json({ error: safe.code }, { status: safe.status, headers });
  }
}
export function POST(request: Request) { return mutate(request, false); }
export function DELETE(request: Request) { return mutate(request, true); }
