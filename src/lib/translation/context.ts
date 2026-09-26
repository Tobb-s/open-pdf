import { MAX_CONTEXT_CHARS, MAX_CONTEXT_ITEM_CHARS, MAX_CONTEXT_ITEMS, type ContextSegment, type Segment } from './contracts';
import type { TranslationPage } from './layout';

/** Short excerpts only; excluded blocks and the requested IDs never leave the browser as context. */
export function buildTranslationContext(pages: TranslationPage[], targets: Segment[]): ContextSegment[] {
  const blocks = pages.flatMap(p => p.blocks).filter(b => b.included && b.source.trim());
  const targetIds = new Set(targets.map(s => s.id));
  const indices = blocks.flatMap((b, i) => targetIds.has(b.id) ? [i] : []);
  if (!indices.length) return [];
  const first = indices[0], last = indices[indices.length - 1];
  const selected = new Map<number, ContextSegment['position']>();
  for (let i = first - 1; i >= Math.max(0, first - 2); i--) selected.set(i, 'before');
  for (let i = last + 1; i < Math.min(blocks.length, last + 3); i++) selected.set(i, 'after');
  // Reuse nearby accepted wording, including user corrections, without harvesting a glossary.
  let references = 0;
  for (let i = first - 1; i >= 0 && references < 2; i--) {
    if (!selected.has(i) && !targetIds.has(blocks[i].id) && blocks[i].translated.trim()) {
      selected.set(i, 'reference'); references++;
    }
  }
  const result: { index: number; entry: ContextSegment }[] = [];
  let remaining = MAX_CONTEXT_CHARS;
  for (const [index, position] of selected) {
    if (targetIds.has(blocks[index].id) || result.length >= MAX_CONTEXT_ITEMS || remaining < 2) continue;
    const block = blocks[index], accepted = block.translated.trim();
    const limit = Math.min(MAX_CONTEXT_ITEM_CHARS, remaining);
    const sourceLimit = accepted ? Math.floor(limit / 2) : limit;
    const excerpt = (text: string, count: number) => position === 'after' ? text.slice(0, count) : text.slice(-count);
    const text = excerpt(block.source.trim(), sourceLimit).trim();
    const translation = accepted ? excerpt(accepted, limit - text.length).trim() : undefined;
    if (!text) continue;
    remaining -= text.length + (translation?.length ?? 0);
    result.push({ index, entry: { id: block.id, text, position, ...(translation ? { translation } : {}) } });
  }
  return result.sort((a, b) => a.index - b.index).map(r => r.entry);
}
