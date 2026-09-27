import type { CleanElement } from './clean-contract';

/** A narrow cover-page safeguard: a sidebar must not interrupt a connected title/subtitle.
 * Does not reorder ordinary paragraphs, mixed image streams or ambiguous columns. */
export function keepCleanTitlesTogether(elements: CleanElement[]): CleanElement[] {
  const result = [...elements];
  for (let i = 0; i < result.length; i++) {
    const first = result[i];
    if (first.kind !== 'heading') continue;
    let j = i + 1;
    while (j < result.length && result[j].kind === 'paragraph' &&
      result[j].box.x >= first.box.x + first.box.width + 20) j++;
    if (j === i + 1 || j >= result.length) continue;
    const next = result[j];
    if (next.kind !== 'heading' || Math.abs(next.box.x - first.box.x) > 20 ||
        next.box.y < first.box.y + first.box.height || next.box.y - first.box.y - first.box.height > 60) continue;
    result.splice(i + 1, j - i, next, ...result.slice(i + 1, j));
  }
  return result;
}
