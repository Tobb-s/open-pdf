import { credentialHeaders } from '@/lib/account/contracts';
import { TranslationError } from './contracts';
import { validateCleanRequest, validateCleanResult, type CleanRequest } from './clean-contract';

export async function requestCleanPage(input: CleanRequest, credentials: { apiKey: string; savedProviderId?: string }, signal: AbortSignal) {
  const checked = validateCleanRequest(input);
  signal.throwIfAborted();
  const response = await fetch('/api/translation-clean', { method: 'POST', cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(110000)]),
    headers: { 'Content-Type': 'application/json', ...credentialHeaders(credentials.apiKey, credentials.savedProviderId) },
    body: JSON.stringify(checked) });
  let data;
  try { data = await response.json(); } catch { throw new TranslationError('invalid_response'); }
  signal.throwIfAborted();
  if (!response.ok) throw new TranslationError(typeof data?.error === 'string' ? data.error : 'review_failed');
  return validateCleanResult(data, checked.blocks);
}
