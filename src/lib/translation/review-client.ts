import { credentialHeaders } from '@/lib/account/contracts';
import { TranslationError } from './contracts';
import { validateRegionResult } from './review-contract';

/** One explicit review, never a retry. No PDF, glossary, context or translated text. */
export async function requestRegionReview(input: { model: string; image: string; sourceText: string; task?: 'classify_noise' },
  credentials: { apiKey: string; savedProviderId?: string }, signal: AbortSignal) {
  signal.throwIfAborted();
  const response = await fetch('/api/translation-review', { method: 'POST', cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(110_000)]),
    headers: { 'Content-Type': 'application/json', ...credentialHeaders(credentials.apiKey, credentials.savedProviderId) },
    body: JSON.stringify({ ...input, model: input.model.trim(), consent: true }),
  });
  let data;
  try { data = await response.json(); } catch { throw new TranslationError('invalid_response'); }
  signal.throwIfAborted();
  if (!response.ok) throw new TranslationError(typeof data?.error === 'string' ? data.error : 'review_failed');
  return validateRegionResult(data, input.task);
}
