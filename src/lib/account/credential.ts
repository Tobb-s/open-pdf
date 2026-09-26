import { TranslationError, type TranslationSettings } from '@/lib/translation/contracts';
import { isSavedProviderId } from './contracts';

// Lazy server imports keep guest BYOK independent from account infrastructure.
export async function resolveCredential(request: Request, settings: Pick<TranslationSettings, 'provider' | 'model' | 'baseUrl'>) {
  const id = request.headers.get('x-openpdf-provider');
  if (id !== null) {
    if (!isSavedProviderId(id) || request.headers.has('authorization')) throw new TranslationError('invalid_request');
    const { requireAccount } = await import('./auth');
    const { loadProvider } = await import('./store');
    const user = await requireAccount(), saved = await loadProvider(user.ownerId, id);
    // The stored model is a default, not a restriction. Owners may choose another
    // model with the same key, but never change the credential's destination.
    if (saved.provider !== settings.provider ||
        (saved.baseUrl ?? '') !== (settings.baseUrl ?? '')) throw new TranslationError('provider_mismatch', 409);
    return saved.apiKey;
  }
  const auth = request.headers.get('authorization') ?? '';
  if (!/^Bearer [\x21-\x7E]{10,2048}$/.test(auth)) throw new TranslationError('key_required', 401);
  return auth.slice(7);
}
