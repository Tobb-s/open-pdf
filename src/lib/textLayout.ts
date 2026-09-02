/**
 * Reassembles the loose text fragments pdf.js reports into lines, paragraphs,
 * headings, and tables.
 *
 * A PDF has no notion of a word, a paragraph, or a table: it has glyph runs placed at
 * coordinates. Concatenating those runs directly is what glued words together,
 * and turning tabular runs into flat paragraphs made exported Word documents uneditable.
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
  fontName?: string;
  isBold?: boolean;
  isItalic?: boolean;
}

export interface RichRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type DocElement =
  | { type: 'heading'; level: 1 | 2 | 3; text: string; runs: RichRun[] }
  | { type: 'paragraph'; text: string; runs: RichRun[] }
  | { type: 'table'; rows: string[][] };

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
  fontName?: string;
};

/** Narrows pdf.js's `getTextContent()` items to the geometry this module needs. */
export function toTextFragments(items: readonly unknown[]): TextFragment[] {
  const fragments: TextFragment[] = [];

  for (const raw of items) {
    const item = raw as PdfJsTextItem;
    if (typeof item?.str !== 'string' || !Array.isArray(item.transform)) continue;

    const fontName = typeof item?.fontName === 'string' ? item.fontName : undefined;
    const isBold = Boolean(fontName && /bold|black|heavy|w[7-9]00/i.test(fontName));
    const isItalic = Boolean(fontName && /italic|oblique/i.test(fontName));

    const fragment: TextFragment = {
      str: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: item.width ?? 0,
      height: item.height || Math.abs(item.transform[3] ?? 0) || 10,
      hasEOL: item.hasEOL === true,
    };

    if (fontName !== undefined) {
      fragment.fontName = fontName;
      if (isBold) fragment.isBold = true;
      if (isItalic) fragment.isItalic = true;
    }

    fragments.push(fragment);
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

    // Only a gap wide enough to be a real space becomes one.
    const gap = next.x - (fragment.x + fragment.width);
    if (gap > Math.max(fragment.height, next.height) * SPACE_GAP_EM) {
      text += ' ';
    }
  }

  return text;
}

/**
 * Builds rich runs for a line, preserving bold and italic styles.
 */
function lineToRichRuns(line: TextFragment[]): RichRun[] {
  const runs: RichRun[] = [];

  for (let i = 0; i < line.length; i += 1) {
    const fragment = line[i];
    let fragmentText = fragment.str;

    const next = line[i + 1];
    if (next) {
      const alreadySpaced = /\s$/.test(fragmentText) || /^\s/.test(next.str);
      const gap = next.x - (fragment.x + fragment.width);
      if (!alreadySpaced && gap > Math.max(fragment.height, next.height) * SPACE_GAP_EM) {
        fragmentText += ' ';
      }
    }

    if (runs.length > 0) {
      const last = runs[runs.length - 1];
      if (Boolean(last.bold) === Boolean(fragment.isBold) && Boolean(last.italic) === Boolean(fragment.isItalic)) {
        last.text += fragmentText;
        continue;
      }
    }

    runs.push({
      text: fragmentText,
      bold: fragment.isBold,
      italic: fragment.isItalic,
    });
  }

  return runs;
}

/**
 * The document's ordinary line spacing.
 */
function typicalLineGap(gaps: number[]): number {
  if (gaps.length === 0) return 0;
  const sorted = [...gaps].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * Groups a page's fragments into plain text paragraphs.
 */
export function extractParagraphs(fragments: TextFragment[]): string[] {
  const elements = extractDocumentElements(fragments);
  const result: string[] = [];

  for (const el of elements) {
    if (el.type === 'heading' || el.type === 'paragraph') {
      result.push(el.text);
    } else if (el.type === 'table') {
      for (const row of el.rows) {
        result.push(row.join(' | '));
      }
    }
  }

  return result;
}

interface ColumnFragment {
  x: number;
  text: string;
}

/**
 * Splits a line into columns if wide gaps exist between fragments.
 */
function extractLineColumns(line: TextFragment[]): ColumnFragment[] {
  if (line.length === 0) return [];
  const columns: ColumnFragment[] = [];
  let currentColX = line[0].x;
  let currentText = line[0].str;

  for (let i = 1; i < line.length; i++) {
    const prev = line[i - 1];
    const curr = line[i];
    const gap = curr.x - (prev.x + prev.width);

    // If gap is wider than 22pt, treat as a table column separator
    if (gap > 22) {
      columns.push({ x: currentColX, text: currentText.trim() });
      currentColX = curr.x;
      currentText = curr.str;
    } else {
      const needSpace = !/\s$/.test(currentText) && !/^\s/.test(curr.str) && gap > 3;
      currentText += (needSpace ? ' ' : '') + curr.str;
    }
  }

  columns.push({ x: currentColX, text: currentText.trim() });
  return columns.filter((c) => c.text !== '');
}

/**
 * Checks if two sets of column start coordinates roughly align.
 */
function columnsAlign(a: ColumnFragment[], b: ColumnFragment[]): boolean {
  if (a.length < 2 || b.length < 2) return false;
  if (Math.abs(a.length - b.length) > 1) return false;

  let matches = 0;
  for (const colA of a) {
    for (const colB of b) {
      if (Math.abs(colA.x - colB.x) < 18) {
        matches++;
        break;
      }
    }
  }

  return matches >= Math.min(a.length, b.length) - 1;
}

/**
 * Extracts rich document elements (Headings, Paragraphs, Tables) from PDF text fragments.
 */
export function extractDocumentElements(fragments: TextFragment[]): DocElement[] {
  const lines = groupIntoLines(fragments).filter((line) => !isBlank(joinLine(line)));
  if (lines.length === 0) return [];

  // Calculate typical font height
  const heights = fragments.map((f) => f.height).filter((h) => h > 0);
  heights.sort((a, b) => a - b);
  const typicalHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 10;

  const baselines = lines.map((line) => line[0].y);
  const gaps: number[] = [];
  for (let i = 1; i < baselines.length; i += 1) {
    const gap = baselines[i - 1] - baselines[i];
    if (gap > 0) gaps.push(gap);
  }
  const typicalGap = typicalLineGap(gaps);

  const elements: DocElement[] = [];
  let lineIdx = 0;

  while (lineIdx < lines.length) {
    const currentLine = lines[lineIdx];
    const lineCols = extractLineColumns(currentLine);

    // 1. Table Detection: check if current line and next line form aligned columns
    if (lineCols.length >= 2 && lineIdx + 1 < lines.length) {
      const nextCols = extractLineColumns(lines[lineIdx + 1]);
      if (columnsAlign(lineCols, nextCols)) {
        // Collect consecutive table rows
        const tableRows: string[][] = [lineCols.map((c) => c.text)];
        lineIdx++;

        while (lineIdx < lines.length) {
          const rowCols = extractLineColumns(lines[lineIdx]);
          if (rowCols.length >= 2 && columnsAlign(lineCols, rowCols)) {
            tableRows.push(rowCols.map((c) => c.text));
            lineIdx++;
          } else {
            break;
          }
        }

        elements.push({ type: 'table', rows: tableRows });
        continue;
      }
    }

    // 2. Heading Detection
    const lineText = joinLine(currentLine).trim();
    const lineHeight = currentLine[0].height;
    const isProminentHeight = typicalHeight > 0 && lineHeight >= typicalHeight * 1.35;
    const isHeadingLength = lineText.length < 110;

    const prevGap = lineIdx > 0 ? baselines[lineIdx - 1] - baselines[lineIdx] : 0;
    const nextGap = lineIdx + 1 < lines.length ? baselines[lineIdx] - baselines[lineIdx + 1] : 0;
    const isIsolated = (prevGap > typicalGap * 1.3 || lineIdx === 0) && (nextGap > typicalGap * 1.3 || lineIdx + 1 === lines.length);

    if (isProminentHeight && isHeadingLength && isIsolated) {
      const level: 1 | 2 | 3 = lineHeight >= typicalHeight * 1.6 ? 1 : lineHeight >= typicalHeight * 1.35 ? 2 : 3;
      elements.push({
        type: 'heading',
        level,
        text: lineText,
        runs: lineToRichRuns(currentLine),
      });
      lineIdx++;
      continue;
    }

    // 3. Regular Paragraph Collection
    const paragraphLines: TextFragment[][] = [currentLine];
    lineIdx++;

    while (lineIdx < lines.length) {
      const gap = baselines[lineIdx - 1] - baselines[lineIdx];
      const movedBackUp = gap < 0;
      const openedUp = typicalGap > 0 && gap > typicalGap * 1.45;

      const nextCols = extractLineColumns(lines[lineIdx]);
      const nextIsTableStart =
        nextCols.length >= 2 &&
        lineIdx + 1 < lines.length &&
        columnsAlign(nextCols, extractLineColumns(lines[lineIdx + 1]));

      const nextLineHeight = lines[lineIdx][0].height;
      const nextIsHeading =
        typicalHeight > 0 &&
        nextLineHeight >= typicalHeight * 1.35 &&
        joinLine(lines[lineIdx]).trim().length < 110;

      if (movedBackUp || openedUp || nextIsTableStart || nextIsHeading) {
        break;
      }

      paragraphLines.push(lines[lineIdx]);
      lineIdx++;
    }

    // Join paragraph lines and runs
    let joinedText = '';
    const allRuns: RichRun[] = [];

    for (let pIdx = 0; pIdx < paragraphLines.length; pIdx++) {
      const pLine = paragraphLines[pIdx];
      const pLineText = joinLine(pLine);
      const pLineRuns = lineToRichRuns(pLine);

      if (pIdx > 0) {
        // Hyphen handling mid-word
        if (/[-‐‑]$/.test(joinedText) && /^[a-zß-ÿ]/.test(pLineText)) {
          joinedText = joinedText.slice(0, -1) + pLineText;
          if (allRuns.length > 0 && pLineRuns.length > 0) {
            allRuns[allRuns.length - 1].text = allRuns[allRuns.length - 1].text.slice(0, -1);
          }
        } else {
          joinedText += ' ' + pLineText;
          if (allRuns.length > 0) {
            allRuns[allRuns.length - 1].text += ' ';
          }
        }
      } else {
        joinedText = pLineText;
      }

      allRuns.push(...pLineRuns);
    }

    elements.push({
      type: 'paragraph',
      text: joinedText.trim(),
      runs: allRuns.filter((r) => r.text.length > 0),
    });
  }

  return elements;
}
