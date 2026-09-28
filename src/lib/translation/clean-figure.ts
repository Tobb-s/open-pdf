import { TranslationError } from './contracts';
import type { CleanPage } from './clean-contract';
import type { Box } from './layout';

/** Search beyond approximate AI bounds, including assigned OCR labels, but stop before
 * known neighboring prose/captions. Never paint over source ink to manufacture a clean crop. */
export function figureSearchBox(page: CleanPage, index: number, padding = 60): Box {
  const e = page.elements[index];
  const owned = page.reference.filter(b => e.ids.includes(b.id));
  const boxes = [e.box, ...owned];
  const core = { x: Math.min(...boxes.map(b => b.x)), y: Math.min(...boxes.map(b => b.y)),
    right: Math.max(...boxes.map(b => b.x + b.width)), bottom: Math.max(...boxes.map(b => b.y + b.height)) };
  let left = Math.max(0, core.x - padding), top = Math.max(0, core.y - padding);
  let right = Math.min(1000, core.right + padding), bottom = Math.min(1000, core.bottom + padding);
  const neighbors = [...page.reference.filter(b => !e.ids.includes(b.id)),
    ...page.elements.filter((_, i) => i !== index).map(other => other.box)];
  for (const b of neighbors) {
    const bx = b.x + b.width, by = b.y + b.height;
    const horizontal = Math.min(core.right, bx) > Math.max(core.x, b.x);
    const vertical = Math.min(core.bottom, by) > Math.max(core.y, b.y);
    if (horizontal && vertical) throw new TranslationError('clean_uncertain');
    if (horizontal && by <= core.y) top = Math.max(top, by + 1);
    if (horizontal && b.y >= core.bottom) bottom = Math.min(bottom, b.y - 1);
    if (vertical && bx <= core.x) left = Math.max(left, bx + 1);
    if (vertical && b.x >= core.right) right = Math.min(right, b.x - 1);
  }
  // Corner furniture can enter the expanded rectangle without overlapping either core band.
  for (const b of neighbors) {
    const bx = b.x + b.width, by = b.y + b.height;
    if (Math.min(right, bx) <= Math.max(left, b.x) || Math.min(bottom, by) <= Math.max(top, b.y)) continue;
    if (bx <= core.x) left = Math.max(left, bx + 1);
    else if (b.x >= core.right) right = Math.min(right, b.x - 1);
    else if (by <= core.y) top = Math.max(top, by + 1);
    else if (b.y >= core.bottom) bottom = Math.min(bottom, b.y - 1);
  }
  if (left >= core.x || top >= core.y || right <= core.right || bottom <= core.bottom) throw new TranslationError('clean_uncertain');
  return { x: left, y: top, width: right - left, height: bottom - top };
}
