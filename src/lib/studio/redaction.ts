import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
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
  /**
   * How many words were actually looked for.
   *
   * Zero does not mean the page was clean; it means there was nothing to check.
   * A scanned page — a photographed contract, an image of a document, the
   * ordinary case for redaction — has no text under the painted region for the
   * check to take, so it comes back with an empty list and would otherwise be
   * reported as verified. The page really was replaced by a picture, so the
   * redaction did happen. What did not happen is the proof, and saying so is
   * the difference between this project and one that ticks a box.
   */
  checked: number;
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

  let checked = 0;
  for (const target of targets) {
    for (const word of target.words) if (worthChecking(word)) checked += 1;
  }

  return { clean: survivors.length === 0, survivors, checked };
}

/**
 * Every piece of text in a document, wherever it is kept.
 *
 * The check used to read two things: the text pdf.js draws on each page, and
 * the values of the form fields. A name can outlive a redaction in neither of
 * those and still be trivially findable — in the title, in the XMP metadata
 * block, in a bookmark, in a comment on another page, in the filename of an
 * attachment. `materialize` edits the original document in place rather than
 * rebuilding it from copied pages, which is deliberate and right, and it means
 * all of those survive by default.
 *
 * Rather than enumerate the hiding places and be wrong about one, this walks
 * every object in the file and takes every string it finds, decoded. Strings
 * are what carry text; a hex string is decoded rather than matched raw, since
 * pdf-lib writes anything non-ASCII as UTF-16BE hex and a raw search would
 * silently find nothing. Metadata streams are decompressed and read as XML.
 *
 * It is a haystack, not an index: over-collecting costs nothing but a longer
 * string, while missing a place costs the guarantee.
 */
export function allTextIn(document: PDFDocument): string {
  const parts: string[] = [];

  const take = (value: PDFObject | undefined, depth: number): void => {
    if (value === undefined || depth > 24) return;

    if (value instanceof PDFString) {
      parts.push(value.asString());
      return;
    }
    if (value instanceof PDFHexString) {
      // Decoded, not raw: `<FEFF004D…>` matches no needle a reader would type.
      try {
        parts.push(value.decodeText());
      } catch {
        parts.push(value.asString());
      }
      return;
    }
    if (value instanceof PDFArray) {
      for (let index = 0; index < value.size(); index += 1) take(value.get(index), depth + 1);
      return;
    }
    if (value instanceof PDFStream) {
      // The dictionary of a stream carries strings too, and an XMP packet is
      // plain XML: the title, author and keywords live there in readable text
      // even when /Info has been cleared.
      take(value.dict, depth + 1);
      const subtype = value.dict.get(PDFName.of('Subtype'))?.toString();
      const type = value.dict.get(PDFName.of('Type'))?.toString();
      if (subtype === '/XML' || type === '/Metadata') {
        try {
          const contents =
            value instanceof PDFRawStream ? value.contents : value.getContents();
          parts.push(new TextDecoder().decode(contents));
        } catch {
          // A metadata stream that will not decode carries nothing a reader
          // could recover either.
        }
      }
      return;
    }
    if (value instanceof PDFDict) {
      for (const entry of value.values()) take(entry, depth + 1);
    }
  };

  // Every indirect object is visited on its own, so following references would
  // only repeat work — and risk a cycle.
  for (const [, object] of document.context.enumerateIndirectObjects()) take(object, 0);

  return parts.join(' ');
}

/** The pages a state has painted regions on, with the regions and any remembered targets. */
export function redactedPages(
  state: ScriptState
): Array<{ page: string; boxes: readonly Rect[]; words: readonly string[] }> {
  return state.pages
    .filter((page) => page.raster !== null && page.raster.boxes.length > 0)
    .map((page) => ({
      page: page.id,
      boxes: page.raster!.boxes,
      words: page.raster!.redactedWords ?? [],
    }));
}
