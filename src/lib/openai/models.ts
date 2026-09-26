import { TranslationError } from '@/lib/translation/contracts';

export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';
export type ModelKind = 'text' | 'specialized' | 'legacy';
export interface OpenAIModel { id: string; kind: ModelKind }

/** The models API supplies IDs, not capability guarantees. Keep every ID visible;
 * only label known incompatible families. New text models still require validation. */
export function modelKind(id: string): ModelKind {
  if (/audio|realtime|live|image|transcrib|tts|whisper|embedding|moderation|dall-e|sora|computer-use|deep-research|search|instruct|davinci|babbage/i.test(id)) return 'specialized';
  if (/^gpt-3\.5|^gpt-4(?:$|-)|^o1-(?:mini|preview)/.test(id)) return 'legacy';
  return 'text';
}
export function parseModels(value: unknown): OpenAIModel[] {
  const data = (value as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length > 5000) throw new TranslationError('invalid_response', 502);
  const ids = data.map(item => {
    const id = item?.id;
    if (typeof id !== 'string' || !/^[\w./:-]{1,120}$/.test(id)) throw new TranslationError('invalid_response', 502);
    return id;
  });
  return [...new Set(ids)].sort((a, b) => a === DEFAULT_OPENAI_MODEL ? -1 : b === DEFAULT_OPENAI_MODEL ? 1 : a.localeCompare(b))
    .map(id => ({ id, kind: modelKind(id) }));
}
