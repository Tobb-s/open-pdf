import { TranslationError } from './contracts';

export const MAX_REVIEW_IMAGE_BYTES = 1_500_000;
export const MAX_REVIEW_BODY_BYTES = 2_050_000;
export type ReviewNoiseReason = 'none' | 'scan_mark' | 'running_header' | 'running_footer' | 'page_number';
export interface RegionReviewRequest { model: string; image: string; sourceText: string; consent: true; task?: 'classify_noise' }
export interface RegionReviewResult { text: string; uncertain: boolean; noiseReason?: ReviewNoiseReason }
export function validRegionalText(text: unknown): text is string {
  return typeof text === 'string' && !!text.trim() && text.length <= 12_000 && text.isWellFormed() &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
}

/** Inline PNG only: never let image input become an arbitrary URL fetch. Header checks bound dimensions;
 * the provider still validates/decodes the complete PNG, which this server does not render. */
export function validateRegionImage(image: unknown) {
  if (typeof image !== 'string' || image.length > Math.ceil(MAX_REVIEW_IMAGE_BYTES / 3) * 4 + 22 ||
      !/^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image)) {
    throw new TranslationError('invalid_region');
  }
  let bytes: string;
  try { bytes = atob(image.slice(22)); } catch { throw new TranslationError('invalid_region'); }
  if (bytes.length < 33 || bytes.length > MAX_REVIEW_IMAGE_BYTES ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes.charCodeAt(i) === b) ||
      bytes.slice(12, 16) !== 'IHDR') throw new TranslationError('invalid_region');
  const integer = (offset: number) => Array.from(bytes.slice(offset, offset + 4))
    .reduce((n, c) => n * 256 + c.charCodeAt(0), 0);
  const width = integer(16), height = integer(20);
  if (integer(8) !== 13 || !width || !height || width > 2000 || height > 2000 || width * height > 3_000_000) {
    throw new TranslationError('invalid_region');
  }
  return image;
}
export function validateRegionReview(value: unknown): RegionReviewRequest {
  if (!value || typeof value !== 'object') throw new TranslationError('invalid_request');
  const v = value as Record<string, unknown>;
  if (v.consent !== true) throw new TranslationError('consent_required');
  if (typeof v.model !== 'string' || !/^[\w./:-]{1,120}$/.test(v.model) ||
      typeof v.sourceText !== 'string' || v.sourceText.length > 12_000 ||
      (v.task !== undefined && v.task !== 'classify_noise')) throw new TranslationError('invalid_request');
  return { model: v.model, sourceText: v.sourceText, image: validateRegionImage(v.image), consent: true,
    ...(v.task === 'classify_noise' ? { task: 'classify_noise' as const } : {}) };
}
export function validateRegionResult(value: unknown, task?: 'classify_noise'): RegionReviewResult {
  const v = value as Partial<RegionReviewResult> | null;
  if (!v || !validRegionalText(v.text) || typeof v.uncertain !== 'boolean') throw new TranslationError('invalid_response', 502);
  if (task === 'classify_noise') {
    if (!['none', 'scan_mark', 'running_header', 'running_footer', 'page_number'].includes(v.noiseReason ?? '') ||
      (v.noiseReason !== 'none' && (v.uncertain || /\b(?:WPS\s*\d+|ISBN|ISSN|DOI)\b/i.test(v.text)))) throw new TranslationError('invalid_response', 502);
    return { text: v.text.trim(), uncertain: v.uncertain, noiseReason: v.noiseReason };
  }
  return { text: v.text.trim(), uncertain: v.uncertain };
}
export const REGION_SCHEMA = { type: 'object', additionalProperties: false, required: ['text', 'uncertain'],
  properties: { text: { type: 'string' }, uncertain: { type: 'boolean' } } };
export const NOISE_REVIEW_SCHEMA = { type: 'object', additionalProperties: false, required: ['text', 'uncertain', 'noiseReason'],
  properties: { ...REGION_SCHEMA.properties, noiseReason: { type: 'string', enum: ['none', 'scan_mark', 'running_header', 'running_footer', 'page_number'] } } };
