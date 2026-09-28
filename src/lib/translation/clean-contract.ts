import { TranslationError } from './contracts';
import { validateRegionImage, validRegionalText } from './review-contract';
import type { Box } from './layout';

export const CLEAN_SAMPLE_LIMIT = 10;
export const CLEAN_KINDS = ['heading', 'paragraph', 'list', 'note', 'formula', 'figure', 'noise'] as const;
export type CleanKind = typeof CLEAN_KINDS[number];
export interface CleanReference extends Box { id: string; text: string }
export interface CleanRequest { model: string; image: string; blocks: CleanReference[]; consent: true }
export interface CleanElement {
  kind: CleanKind; ids: string[]; text: string; box: Box;
  noiseReason: 'none' | 'page_number' | 'running_header' | 'running_footer' | 'scan_mark';
  uncertain: boolean;
}
export interface CleanPage {
  number: number; width: number; height: number; reference: CleanReference[];
  elements: (CleanElement & { translated: string; translatedSource?: string; verification?: { text: string; model: string } })[];
}
export function cleanReadingConfirmed(text: string, verification?: { text: string; model: string }) {
  const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
  return !!verification?.model && compact(text) === compact(verification.text) && !/\[(?:illegible|ilegible)\]/i.test(text);
}
const fail = () => { throw new TranslationError('invalid_response', 502); };
function validBox(v: unknown): v is Box {
  if (!v || typeof v !== 'object') return false;
  const b = v as Box;
  return [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.x >= 0 && b.y >= 0 &&
    b.width > 0 && b.height > 0 && b.x + b.width <= 1000.1 && b.y + b.height <= 1000.1;
}
export function validateCleanRequest(value: unknown): CleanRequest {
  const v = value as Partial<CleanRequest> | null;
  if (!v || v.consent !== true) throw new TranslationError('consent_required');
  if (typeof v.model !== 'string' || !/^[\w./:-]{1,120}$/.test(v.model) || !Array.isArray(v.blocks) ||
      v.blocks.length > 200 || v.blocks.reduce((n, b) => n + (typeof b?.text === 'string' ? b.text.length : 0), 0) > 22000 ||
      v.blocks.some(b => !b || typeof b.id !== 'string' || !/^[\w-]{1,80}$/.test(b.id) || !validRegionalText(b.text) || !validBox(b)) ||
      new Set(v.blocks.map(b => b.id)).size !== v.blocks.length) throw new TranslationError('invalid_request');
  return { model: v.model, image: validateRegionImage(v.image), blocks: v.blocks.map(b => ({
    id: b.id, text: b.text, x: b.x, y: b.y, width: b.width, height: b.height,
  })), consent: true };
}

/** Some vision responses recover a paragraph but forget its OCR ID. Link only unique near-identical
 * full paragraphs, never a short common phrase or a summary. Validation still requires full coverage. */
export function linkRecoveredReferences(value: unknown, blocks: CleanReference[]): unknown {
  const raw = (value as { elements?: CleanElement[] } | null)?.elements;
  if (!Array.isArray(raw) || raw.some(e => !e || !Array.isArray(e.ids))) return value;
  const used = new Set(raw.flatMap(e => e.ids));
  const tokens = (text: string) => text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const similar = (a: string, b: string) => {
    if (a.length < 40 || b.length < 40) return false;
    const left = tokens(a), right = tokens(b), counts = new Map<string, number>();
    right.forEach(t => counts.set(t, (counts.get(t) ?? 0) + 1));
    let matched = 0;
    for (const t of left) if (counts.get(t)) { matched++; counts.set(t, counts.get(t)! - 1); }
    return matched >= left.length * .9 && matched >= right.length * .9;
  };
  const elements = raw.map(e => ({ ...e, ids: [...e.ids] }));
  // OCR can merge several real paragraphs into one ID. Preserve their explicit breaks together,
  // but only when adjacent recovered pieces account for that entire source almost verbatim.
  for (let i = 0; i < elements.length; i++) {
    const first = elements[i];
    if (first.kind !== 'paragraph' || typeof first.text !== 'string') continue;
    let combined = first.text;
    for (let j = i + 1; j < Math.min(elements.length, i + 5); j++) {
      const extra = elements[j];
      if (extra.kind !== first.kind || typeof extra.text !== 'string') break;
      combined += '\n\n' + extra.text;
      const pieces = elements.slice(i, j + 1), ids = pieces.flatMap(e => e.ids);
      if (!ids.length || !pieces.some(e => !e.ids.length)) continue;
      const before = ids.map(id => blocks.find(b => b.id === id)?.text ?? '').join(' ');
      if (similar(before, combined)) {
        if (pieces.some(e => !validBox(e.box))) break;
        const x = Math.min(...pieces.map(e => e.box.x)), y = Math.min(...pieces.map(e => e.box.y));
        const right = Math.max(...pieces.map(e => e.box.x + e.box.width)), bottom = Math.max(...pieces.map(e => e.box.y + e.box.height));
        elements.splice(i, j - i + 1, { ...first, ids, text: combined, box: { x, y, width: right - x, height: bottom - y },
          uncertain: pieces.some(e => e.uncertain) });
        break;
      }
    }
  }
  for (const block of blocks.filter(b => !used.has(b.id))) {
    const matches = elements.filter(e => !e.ids.length && !['noise', 'figure'].includes(e.kind) && typeof e.text === 'string' && similar(block.text, e.text));
    if (matches.length === 1 && blocks.filter(b => !used.has(b.id) && similar(b.text, matches[0].text)).length === 1) {
      matches[0].ids.push(block.id); used.add(block.id);
    }
  }
  return { elements };
}

/** Every OCR ID is accounted for once. Reordering, summarizing and exclusions are separate risks. */
export function validateCleanResult(value: unknown, blocks: CleanReference[]): CleanElement[] {
  const raw = (value as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(raw) || (!raw.length && blocks.length > 0) || raw.length > 250) return fail();
  const known = new Map(blocks.map(b => [b.id, b])), seen = new Set<string>();
  let characters = 0;
  const elements = raw.map(v => {
    const e = v as CleanElement;
    if (!e || !CLEAN_KINDS.includes(e.kind) || !Array.isArray(e.ids) || !validBox(e.box) ||
        typeof e.uncertain !== 'boolean' || typeof e.text !== 'string' ||
        (e.text && !validRegionalText(e.text)) || !['none', 'page_number', 'running_header', 'running_footer', 'scan_mark'].includes(e.noiseReason)) return fail();
    const nonTextMark = e.kind === 'noise' && e.noiseReason === 'scan_mark' && !e.ids.length && !e.uncertain;
    if ((e.kind === 'noise') !== (e.noiseReason !== 'none') ||
        (e.kind !== 'figure' && !e.text.trim() && !nonTextMark) || (e.kind === 'noise' && e.uncertain)) return fail();
    let before = '';
    for (const id of e.ids) {
      if (!known.has(id) || seen.has(id)) return fail();
      seen.add(id); before += known.get(id)!.text + ' ';
    }
    // Never accept a large silent shortening of body text as "cleanup".
    if (!['noise', 'figure'].includes(e.kind) && before.trim().length >= 100 &&
        e.text.trim().length < before.trim().length * .6) return fail();
    // Noise may not swallow an entire paragraph. Discarded text remains in provenance.
    if (e.kind === 'noise' && (before.length > 240 || e.text.length > 240)) return fail();
    if (e.kind === 'noise' && /\b(?:WPS\s*\d+|ISBN|ISSN|DOI)\b/i.test(before + ' ' + e.text)) return fail();
    characters += e.text.length;
    if (characters > 30000) return fail();
    const numeric = (text: string) => (text.normalize('NFKC').match(/[-−+]?\d+(?:[.,]\d+)*/g) ?? []).join('|');
    const symbols = (text: string) => (text.match(/[=<>≤≥±×÷∑∫√+*/^−%$€£¥]/gu) ?? []).join('');
    const protectedChange = e.ids.length > 0 && !['noise', 'figure'].includes(e.kind) &&
      (numeric(before) !== numeric(e.text) || symbols(before) !== symbols(e.text) || e.text.length > before.length * 1.8 + 80);
    return { kind: e.kind, ids: [...e.ids], text: e.text.trim(), box: { ...e.box },
      noiseReason: e.noiseReason, uncertain: e.uncertain || protectedChange || /\[(?:illegible|ilegible)\]/i.test(e.text) };
  });
  if (seen.size !== blocks.length) return fail();
  return elements;
}

const boxSchema = { type: 'object', additionalProperties: false, required: ['x', 'y', 'width', 'height'],
  properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } } };
export const CLEAN_SCHEMA = { type: 'object', additionalProperties: false, required: ['coordinateSpace', 'elements'], properties: {
  coordinateSpace: { type: 'string', enum: ['normalized_1000', 'image_pixels'] },
  elements: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['kind', 'ids', 'text', 'box', 'noiseReason', 'uncertain'], properties: {
      kind: { type: 'string', enum: [...CLEAN_KINDS] }, ids: { type: 'array', items: { type: 'string' } },
      text: { type: 'string' }, box: boxSchema, uncertain: { type: 'boolean' },
      noiseReason: { type: 'string', enum: ['none', 'page_number', 'running_header', 'running_footer', 'scan_mark'] },
    } } },
} };
