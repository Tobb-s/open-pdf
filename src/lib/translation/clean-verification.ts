import type { CleanPage } from './clean-contract';
import type { Box } from './layout';
import type { RegionReviewResult } from './review-contract';
const compact = (text: string) => text.replace(/(?<=\p{L})-\s*\n\s*(?=\p{L})/gu, '-').replace(/\s+/g, ' ').trim();
export function cleanVerificationBox(page: CleanPage, index: number): Box {
  const e = page.elements[index];
  const boxes = [e.box, ...page.reference.filter(b => e.ids.includes(b.id))];
  const x = Math.max(0, Math.min(...boxes.map(b => b.x)) - 8), y = Math.max(0, Math.min(...boxes.map(b => b.y)) - 8);
  const right = Math.min(1000, Math.max(...boxes.map(b => b.x + b.width)) + 8);
  const bottom = Math.min(1000, Math.max(...boxes.map(b => b.y + b.height)) + 8);
  return { x, y, width: right - x, height: bottom - y };
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
