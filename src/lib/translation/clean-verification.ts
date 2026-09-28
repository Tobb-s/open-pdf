import type { CleanPage, CleanElement } from './clean-contract';
import type { Box } from './layout';
import type { RegionReviewResult } from './review-contract';
const compact = (text: string) => text.replace(/(?<=\p{L})-\s*\n\s*(?=\p{L})/gu, '-').replace(/\s+/g, ' ').trim();
export function cleanMarginCandidate(e: CleanElement) {
  return e.kind === 'note' && e.text.length <= 240 && e.box.height < 50 &&
    (e.box.y < 110 || e.box.y + e.box.height > 870);
}
export function cleanMarginContext(page: CleanPage, index: number) {
  const e = page.elements[index], box = cleanMarginReviewBox(e);
  return JSON.stringify({ targetText: e.text, targetInCrop: { x: e.box.x, width: e.box.width,
    y: (e.box.y - box.y) / box.height * 1000, height: e.box.height / box.height * 1000 },
    pageContext: page.elements.filter(e => e.kind === 'heading' || e.kind === 'paragraph').slice(0, 2).map(e => e.text.slice(0, 600)) });
}
export function cleanMarginReviewBox(e: CleanElement): Box {
  const top = e.box.y < 110 ? 0 : Math.max(0, e.box.y - 160);
  const bottom = e.box.y < 110 ? Math.min(1000, Math.max(220, e.box.y + e.box.height + 160)) : 1000;
  return { x: 0, y: top, width: 1000, height: bottom - top };
}
export function cleanVerificationBox(page: CleanPage, index: number): Box {
  const e = page.elements[index];
  const boxes = [e.box, ...page.reference.filter(b => e.ids.includes(b.id))];
  const x = Math.max(0, Math.min(...boxes.map(b => b.x)) - 8), y = Math.max(0, Math.min(...boxes.map(b => b.y)) - 8);
  const right = Math.min(1000, Math.max(...boxes.map(b => b.x + b.width)) + 8);
  const bottom = Math.min(1000, Math.max(...boxes.map(b => b.y + b.height)) + 8);
  return { x, y, width: right - x, height: bottom - y };
}
export function cleanVerificationMask(page: CleanPage, index: number): Box[] {
  const e = page.elements[index];
  const separate = (b: Box) => Math.min(e.box.x + e.box.width, b.x + b.width) <= Math.max(e.box.x, b.x) ||
    Math.min(e.box.y + e.box.height, b.y + b.height) <= Math.max(e.box.y, b.y);
  return [...page.reference.filter(b => !e.ids.includes(b.id)),
    ...page.elements.filter((other, i) => i !== index && separate(other.box)).map(other => other.box)];
}
/** A changed proposal needs two agreeing crop readings. This is a heuristic, not proof of fidelity. */
export async function verifyCleanReading(proposal: string, read: () => Promise<RegionReviewResult>) {
  const usable = (r: RegionReviewResult) => !r.uncertain && !/\[(?:illegible|ilegible)\]/i.test(r.text) &&
    r.text.length >= proposal.length * .6 && r.text.length <= proposal.length * 1.8 + 80;
  const first = await read();
  if (!usable(first)) return undefined;
  if (compact(first.text) === compact(proposal)) return first.text;
  const second = await read();
  if (!usable(second)) return undefined;
  if (compact(second.text) === compact(proposal)) return proposal;
  return compact(first.text) === compact(second.text) ? first.text : undefined;
}
