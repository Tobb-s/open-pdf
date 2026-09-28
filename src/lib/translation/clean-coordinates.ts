import { TranslationError } from './contracts';
import { validateRegionImage } from './review-contract';
import type { CleanElement } from './clean-contract';

export function cleanImageDimensions(image: string) {
  const bytes = atob(validateRegionImage(image).slice(22));
  const integer = (offset: number) => Array.from(bytes.slice(offset, offset + 4)).reduce((n, c) => n * 256 + c.charCodeAt(0), 0);
  return { width: integer(16), height: integer(20) };
}

/** Never guess the coordinate system from a plausible-looking rectangle. Legacy responses
 * are normalized; pixels require an explicit declaration and the actual validated PNG size. */
export function normalizeCleanPage(value: unknown, image: string) {
  const v = value as { coordinateSpace?: string; elements?: CleanElement[] } | null;
  if (!v || !Array.isArray(v.elements) || (v.coordinateSpace !== undefined && !['normalized_1000', 'image_pixels'].includes(v.coordinateSpace))) {
    throw new TranslationError('invalid_response', 502);
  }
  const dimensions = cleanImageDimensions(image);
  return { elements: v.elements.map(e => {
    if (!e || !e.box) throw new TranslationError('invalid_response', 502);
    const box = v.coordinateSpace === 'image_pixels' ? {
      x: e.box.x / dimensions.width * 1000, y: e.box.y / dimensions.height * 1000,
      width: e.box.width / dimensions.width * 1000, height: e.box.height / dimensions.height * 1000,
    } : { ...e.box };
    // Doubt is never permission to delete. Keep it as a note for the existing crop review.
    return { ...e, box, ...(e.kind === 'noise' && e.uncertain ? { kind: 'note' as const, noiseReason: 'none' as const } : {}) };
  }) };
}
