import type { Rect, ScriptState } from '@/lib/studio/script';

/**
 * Proving that redacted information is gone.
 *
 * Everything else in this project reports what it did. This is the one place
 * that refuses: if the words a reader painted out can still be found in the
 * file they are about to download, the file is not handed over. A tool that
 * quietly fails to remove a name is worse than one that cannot remove it at
 * all, because the reader stops being careful.
 *
 * The method is deliberately dumb, which is the point. Take the text that was
 * inside each painted region before the page was rasterised, then read every
 * word out of the produced document and look for it. No cleverness, nothing
 * that can be reasoned into a false pass.
 */

export interface RedactionTarget {
  page: string;
  /** The words that were under the painted regions, as the page reported them. */
  words: string[];
}

export interface RedactionVerdict {
  /** True when nothing that was painted out can be found in the produced file. */
  clean: boolean;
  /** The words that survived, if any. Empty when clean. */
  survivors: string[];
}

/**
 * A word is worth checking only if finding it would mean something.
 *
 * A one- or two-character token appears in almost any document by accident, so
 * looking for it would block exports over coincidences and teach the reader to
 * ignore the warning. What matters is that a name, a number or an address does
 * not survive.
 */
export function worthChecking(word: string): boolean {
  const trimmed = word.trim();
  if (trimmed.length < 3) return false;
  // Pure punctuation carries nothing.
  return /[\p{L}\p{N}]/u.test(trimmed);
}

/** Whether a text item's box falls inside a painted region, with a little slack. */
export function insideAny(
  item: { x: number; y: number; width: number; height: number },
  boxes: readonly Rect[],
  slack = 1
): boolean {
  return boxes.some(
    (box) =>
      item.x + item.width > box.x - slack &&
      item.x < box.x + box.width + slack &&
      item.y + item.height > box.y - slack &&
      item.y < box.y + box.height + slack
  );
}

/**
 * Compares what was painted out against what the produced document still says.
 *
 * `producedText` is every word the finished file yields, from every page. The
 * comparison is case-insensitive and ignores spacing, because a viewer that
 * splits a word differently is still showing the reader the word.
 */
export function judgeRedaction(
  targets: readonly RedactionTarget[],
  producedText: string
): RedactionVerdict {
  const haystack = producedText.toLowerCase().replace(/\s+/g, ' ');
  const survivors: string[] = [];

  for (const target of targets) {
    for (const word of target.words) {
      if (!worthChecking(word)) continue;
      const needle = word.trim().toLowerCase().replace(/\s+/g, ' ');
      if (haystack.includes(needle) && !survivors.includes(word.trim())) {
        survivors.push(word.trim());
      }
    }
  }

  return { clean: survivors.length === 0, survivors };
}

/** The pages a state has painted regions on, with the regions. */
export function redactedPages(state: ScriptState): Array<{ page: string; boxes: readonly Rect[] }> {
  return state.pages
    .filter((page) => page.raster !== null && page.raster.boxes.length > 0)
    .map((page) => ({ page: page.id, boxes: page.raster!.boxes }));
}
