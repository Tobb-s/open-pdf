import { TranslationError, type TranslationProvider } from '@/lib/translation/contracts';

export interface SavedProvider {
  id: string;
  label: string;
  provider: TranslationProvider;
  model: string;
  baseUrl?: string;
  keyHint: string;
}
export interface AccountState {
  available: boolean;
  user: { name: string; email?: string; id?: string } | null;
  providers: SavedProvider[];
}
export function isSavedProviderId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}
export function validateProvider(value: unknown): Omit<SavedProvider, 'id' | 'keyHint'> & { apiKey: string } {
  if (!value || typeof value !== 'object') throw new TranslationError('invalid_request');
  const v = value as Record<string, unknown>;
  if (typeof v.label !== 'string' || !v.label.trim() || v.label.trim().length > 80 ||
      !['openai', 'gemini', 'compatible'].includes(String(v.provider)) ||
      typeof v.model !== 'string' || !/^[\w./:-]{1,120}$/.test(v.model) ||
      typeof v.apiKey !== 'string' || !/^[\x21-\x7E]{10,2048}$/.test(v.apiKey) ||
      (v.provider === 'compatible' && (typeof v.baseUrl !== 'string' || v.baseUrl.length > 500))) {
    throw new TranslationError('invalid_request');
  }
  return { label: v.label.trim(), provider: v.provider as TranslationProvider, model: v.model,
    ...(v.provider === 'compatible' ? { baseUrl: v.baseUrl as string } : {}), apiKey: v.apiKey };
}
export function credentialHeaders(apiKey: string, savedProviderId?: string): Record<string, string> {
  return savedProviderId ? { 'X-OpenPDF-Provider': savedProviderId } : { Authorization: `Bearer ${apiKey.trim()}` };
}
