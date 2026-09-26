/** Shared wire contract. Never put credentials or source PDF bytes in this object. */
export type TranslationProvider = 'openai' | 'gemini' | 'compatible';
export interface TranslationSettings {
  provider: TranslationProvider;
  model: string;
  baseUrl?: string;
  glossary: string;
}
export interface Segment { id: string; text: string }
export interface TranslationRequest extends TranslationSettings {
  segments: Segment[];
  consent: true;
}
export class TranslationError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export const MAX_BATCH_CHARS = 12_000;
export const MAX_SEGMENTS = 80;
export function validateRequest(value: unknown): TranslationRequest {
  if (!value || typeof value !== 'object') throw new TranslationError('invalid_request');
  const v = value as Record<string, unknown>;
  if (v.consent !== true) throw new TranslationError('consent_required');
  if (!['openai', 'gemini', 'compatible'].includes(String(v.provider)) ||
      typeof v.model !== 'string' || !/^[\w./:-]{1,120}$/.test(v.model) ||
      typeof v.glossary !== 'string' || v.glossary.length > 3000 ||
      (v.baseUrl !== undefined && typeof v.baseUrl !== 'string') ||
      !Array.isArray(v.segments) || !v.segments.length || v.segments.length > MAX_SEGMENTS) {
    throw new TranslationError('invalid_request');
  }
  const ids = new Set<string>();
  let chars = 0;
  const segments = v.segments.map((s: unknown) => {
    if (!s || typeof s !== 'object') throw new TranslationError('invalid_request');
    const { id, text } = s as Segment;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(id) || ids.has(id) ||
        typeof text !== 'string' || !text.trim() || text.length > MAX_BATCH_CHARS) {
      throw new TranslationError('invalid_request');
    }
    ids.add(id); chars += text.length;
    return { id, text };
  });
  if (chars > MAX_BATCH_CHARS) throw new TranslationError('batch_too_large', 413);
  return { provider: v.provider as TranslationProvider, model: v.model, glossary: v.glossary,
    baseUrl: v.baseUrl as string | undefined, consent: true, segments };
}

/** Fail closed on missing/duplicate/foreign IDs, empty, truncated or enormous output. */
export function validateTranslations(value: unknown, source: Segment[]): Segment[] {
  const raw = (value as { translations?: unknown })?.translations;
  if (!Array.isArray(raw) || raw.length !== source.length) throw new TranslationError('invalid_response', 502);
  const map = new Map<string, string>();
  for (const item of raw) {
    if (!item || typeof item.id !== 'string' || typeof item.text !== 'string' ||
        !item.text.trim() || item.text.length > MAX_BATCH_CHARS * 4 || map.has(item.id)) {
      throw new TranslationError('invalid_response', 502);
    }
    map.set(item.id, item.text.trim());
  }
  return source.map(s => {
    const text = map.get(s.id);
    if (!text) throw new TranslationError('invalid_response', 502);
    return { id: s.id, text };
  });
}

export function batches(segments: Segment[]): Segment[][] {
  const result: Segment[][] = [];
  let current: Segment[] = [], count = 0;
  for (const segment of segments) {
    if (!segment.text.trim() || segment.text.length > MAX_BATCH_CHARS) throw new TranslationError('batch_too_large');
    if (current.length && (count + segment.text.length > MAX_BATCH_CHARS || current.length >= MAX_SEGMENTS)) {
      result.push(current); current = []; count = 0;
    }
    current.push(segment); count += segment.text.length;
  }
  if (current.length) result.push(current);
  return result;
}

export const TRANSLATION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['translations'],
  properties: { translations: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['id', 'text'],
    properties: { id: { type: 'string' }, text: { type: 'string' } },
  } } },
};
