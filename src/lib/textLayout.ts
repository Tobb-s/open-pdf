/**
 * Reassembles the loose text fragments pdf.js reports into lines and paragraphs.
 *
 * A PDF has no notion of a word or a paragraph: it has glyph runs placed at
 * coordinates. Concatenating those runs directly is what glued
 * `Mandelin∗,Mohammad` together — the line break between them carried the space,
 * and the break is not part of any run's text.
 */

export interface TextFragment {
  str: string;
  /** Left edge of the run, in PDF points. */
  x: number;
  /** Baseline of the run, in PDF points, increasing upwards. */
  y: number;
  width: number;
  /** Font size of the run, used to judge what counts as a wide gap. */
  height: number;
  /** pdf.js sets this on the run that ends a rendered line. */
  hasEOL: boolean;
}

/**
 * How wide a gap has to be, relative to the type size, before it counts as a
 * space rather than as positioning. Measured against the standard fonts: a
 * space is 0.250 em in Times and 0.278 em in Helvetica, while the adjustments
 * inside a word are an order of magnitude smaller.
 */
const SPACE_GAP_EM = 0.24;

/** A run whose text is only whitespace still tells us a break happened. */
const isBlank = (value: string) => value.trim() === '';

type PdfJsTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
};

/** Narrows pdf.js's `getTextContent()` items to the geometry this module needs. */
export function toTextFragments(items: readonly unknown[]): TextFragment[] {
  const fragments: TextFragment[] = [];

  for (const raw of items) {
    const item = raw as PdfJsTextItem;
    if (typeof item?.str !== 'string' || !Array.isArray(item.transform)) continue;

    fragments.push({
      str: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: item.width ?? 0,
      height: item.height || Math.abs(item.transform[3] ?? 0) || 10,
      hasEOL: item.hasEOL === true,
    });
  }

  return fragments;
}

function groupIntoLines(fragments: TextFragment[]): TextFragment[][] {
  const lines: TextFragment[][] = [];
  let current: TextFragment[] = [];

  for (let i = 0; i < fragments.length; i += 1) {
    const fragment = fragments[i];
    current.push(fragment);

    const next = fragments[i + 1];
    if (!next) break;

    // A baseline shift larger than half the type size means a new line, even when
    // pdf.js did not flag one — which happens in multi-column and tabular layouts.
    const baselineShift = Math.abs(next.y - fragment.y);
    const breaks = fragment.hasEOL || baselineShift > Math.max(fragment.height, next.height) * 0.5;

    if (breaks) {
      lines.push(current);
      current = [];
    }
  }

  if (current.length > 0) lines.push(current);
  return lines;
}

function joinLine(line: TextFragment[]): string {
  let text = '';

  for (let i = 0; i < line.length; i += 1) {
    const fragment = line[i];
    text += fragment.str;

    const next = line[i + 1];
    if (!next) continue;

    const alreadySpaced = /\s$/.test(fragment.str) || /^\s/.test(next.str);
    if (alreadySpaced) continue;

    // Only a gap wide enough to be a real space becomes one. The threshold sits
    // just under the narrowest space in the standard fonts — 0.250 em in Times,
    // 0.278 em in Helvetica — because anything lower risks reading ordinary
    // letter positioning as a word break.
    const gap = next.x - (fragment.x + fragment.width);
    if (gap > Math.max(fragment.height, next.height) * SPACE_GAP_EM) {
      text += ' ';
    }
  }

  return text;
}

/**
 * The document's ordinary line spacing.
 *
 * Takes the lower middle value for an even count: paragraph gaps are the large
 * outliers, and letting one of them become the baseline is what stopped
 * paragraph breaks from ever being detected in a two-paragraph page.
 */
function typicalLineGap(gaps: number[]): number {
  if (gaps.length === 0) return 0;
  const sorted = [...gaps].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * Groups a page's fragments into paragraphs.
 *
 * Lines are joined with a space, and a paragraph ends where the leading grows
 * clearly beyond the page's usual line spacing.
 */
export function extractParagraphs(fragments: TextFragment[]): string[] {
  const lines = groupIntoLines(fragments).filter((line) => !isBlank(joinLine(line)));
  if (lines.length === 0) return [];

  const baselines = lines.map((line) => line[0].y);
  const gaps: number[] = [];
  for (let i = 1; i < baselines.length; i += 1) {
    const gap = baselines[i - 1] - baselines[i];
    if (gap > 0) gaps.push(gap);
  }

  const typicalGap = typicalLineGap(gaps);
  const paragraphs: string[] = [];
  let current = joinLine(lines[0]);

  for (let i = 1; i < lines.length; i += 1) {
    const gap = baselines[i - 1] - baselines[i];
    const movedBackUp = gap < 0; // a new column, or a new block on the page
    const openedUp = typicalGap > 0 && gap > typicalGap * 1.5;

    if (movedBackUp || openedUp) {
      paragraphs.push(current.trim());
      current = joinLine(lines[i]);
      continue;
    }

    const text = joinLine(lines[i]);
    // A line broken mid-word with a hyphen rejoins without the hyphen.
    if (/[-‐‑]$/.test(current) && /^[a-zß-ÿ]/.test(text)) {
      current = `${current.slice(0, -1)}${text}`;
    } else {
      current = `${current} ${text}`;
    }
  }

  paragraphs.push(current.trim());
  return paragraphs.filter((paragraph) => paragraph !== '');
}
