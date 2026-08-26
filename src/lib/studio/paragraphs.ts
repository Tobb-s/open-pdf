import type { FlatTextRun } from '@/lib/studio/textReplacement';

export type ParagraphAlignment = 'left' | 'center' | 'right';

export interface ParagraphLine {
  runs: readonly FlatTextRun[];
  text: string;
  visual: FlatTextRun['visual'];
  baselineY: number;
}

export interface TextParagraph {
  id: string;
  text: string;
  runs: readonly FlatTextRun[];
  lines: readonly ParagraphLine[];
  visual: FlatTextRun['visual'];
  size: number;
  rotate: number;
}

export interface ParagraphLayout {
  lines: readonly string[];
  widths: readonly number[];
  height: number;
}

const boundsOf = (runs: readonly FlatTextRun[]): FlatTextRun['visual'] => {
  const left = Math.min(...runs.map((run) => run.visual.left));
  const top = Math.min(...runs.map((run) => run.visual.top));
  const right = Math.max(...runs.map((run) => run.visual.left + run.visual.width));
  const bottom = Math.max(...runs.map((run) => run.visual.top + run.visual.height));
  return { left, top, width: right - left, height: bottom - top };
};

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const normalizedRotation = (value: number): number => {
  const wrapped = ((value % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
};

const joinRuns = (runs: readonly FlatTextRun[]): string => {
  let text = '';
  runs.forEach((run, index) => {
    if (index > 0) {
      const previous = runs[index - 1];
      const gap = run.visual.left - (previous.visual.left + previous.visual.width);
      const needsSpace =
        !/\s$/.test(previous.text) &&
        !/^\s/.test(run.text) &&
        gap > Math.max(previous.visual.height, run.visual.height) * 0.12;
      if (needsSpace) text += ' ';
    }
    text += run.text;
  });
  return text.trim();
};

const makeLine = (runs: readonly FlatTextRun[]): ParagraphLine => {
  const ordered = [...runs].sort((a, b) => a.visual.left - b.visual.left);
  return {
    runs: ordered,
    text: joinRuns(ordered),
    visual: boundsOf(ordered),
    baselineY: median(ordered.map((run) => run.y)),
  };
};

/** Groups horizontal pdf.js text items into selectable paragraph blocks. */
export function groupTextParagraphs(runs: readonly FlatTextRun[]): TextParagraph[] {
  const horizontal = runs.filter((run) => Math.abs(normalizedRotation(run.rotate)) <= 5);
  const ordered = [...horizontal].sort(
    (a, b) =>
      a.visual.top + a.visual.height / 2 - (b.visual.top + b.visual.height / 2) ||
      a.visual.left - b.visual.left
  );

  const rows: FlatTextRun[][] = [];
  for (const run of ordered) {
    const center = run.visual.top + run.visual.height / 2;
    const row = rows.find((candidate) => {
      const bounds = boundsOf(candidate);
      const rowCenter = bounds.top + bounds.height / 2;
      return Math.abs(center - rowCenter) <= Math.max(bounds.height, run.visual.height) * 0.55;
    });
    if (row) row.push(run);
    else rows.push([run]);
  }

  const lines = rows.flatMap((row) => {
    const sorted = [...row].sort((a, b) => a.visual.left - b.visual.left);
    const segments: FlatTextRun[][] = [];
    for (const run of sorted) {
      const segment = segments[segments.length - 1];
      const previous = segment?.[segment.length - 1];
      const gap = previous
        ? run.visual.left - (previous.visual.left + previous.visual.width)
        : 0;
      const splitAt = Math.max(48, Math.max(previous?.visual.height ?? 0, run.visual.height) * 4);
      if (!segment || gap > splitAt) segments.push([run]);
      else segment.push(run);
    }
    return segments.map(makeLine);
  });
  lines.sort((a, b) => a.visual.top - b.visual.top || a.visual.left - b.visual.left);

  const blocks: ParagraphLine[][] = [];
  for (const line of lines) {
    const compatible = blocks
      .map((block) => ({ block, previous: block[block.length - 1] }))
      .filter(({ previous }) => {
        const verticalStep = line.visual.top - previous.visual.top;
        const leftAligned = Math.abs(line.visual.left - previous.visual.left) <= Math.max(line.visual.height, 12) * 2;
        const overlap = Math.max(
          0,
          Math.min(line.visual.left + line.visual.width, previous.visual.left + previous.visual.width) -
            Math.max(line.visual.left, previous.visual.left)
        );
        const sameColumn = leftAligned || overlap >= Math.min(line.visual.width, previous.visual.width) * 0.2;
        const nearby = verticalStep >= 0 && verticalStep <= Math.max(line.visual.height, previous.visual.height) * 1.9;
        const currentSize = median(line.runs.map((run) => run.size));
        const previousSize = median(previous.runs.map((run) => run.size));
        const similarSize = Math.max(currentSize, previousSize) / Math.max(1, Math.min(currentSize, previousSize)) <= 1.35;
        return sameColumn && nearby && similarSize;
      })
      .sort((a, b) => b.previous.visual.top - a.previous.visual.top)[0];

    if (!compatible) {
      blocks.push([line]);
      continue;
    }
    compatible.block.push(line);
  }

  return blocks.map((block, index) => {
    const paragraphRuns = block.flatMap((line) => [...line.runs]);
    return {
      id: `paragraph-${index}-${paragraphRuns.map((run) => run.id).join('-')}`,
      text: block.map((line) => line.text).join('\n'),
      runs: paragraphRuns,
      lines: block,
      visual: boundsOf(paragraphRuns),
      size: median(paragraphRuns.map((run) => run.size)),
      rotate: median(paragraphRuns.map((run) => run.rotate)),
    };
  });
}

const splitLongWord = (
  word: string,
  maxWidth: number,
  measure: (value: string) => number
): string[] => {
  const parts: string[] = [];
  let part = '';
  for (const character of word) {
    const candidate = part + character;
    if (part !== '' && measure(candidate) > maxWidth) {
      parts.push(part);
      part = character;
    } else {
      part = candidate;
    }
  }
  if (part !== '') parts.push(part);
  return parts;
};

/** Wraps editable text using the exact width function of the chosen PDF font. */
export function layoutParagraph(
  text: string,
  maxWidth: number,
  size: number,
  lineSpacing: number,
  measure: (value: string) => number
): ParagraphLayout {
  const lines: string[] = [];
  for (const sourceLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = sourceLine.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let current = '';
    for (const originalWord of words) {
      const pieces = measure(originalWord) > maxWidth
        ? splitLongWord(originalWord, maxWidth, measure)
        : [originalWord];
      for (const piece of pieces) {
        const candidate = current === '' ? piece : `${current} ${piece}`;
        if (current !== '' && measure(candidate) > maxWidth) {
          lines.push(current);
          current = piece;
        } else {
          current = candidate;
        }
      }
    }
    if (current !== '') lines.push(current);
  }

  const safeLines = lines.length > 0 ? lines : [''];
  return {
    lines: safeLines,
    widths: safeLines.map(measure),
    height: size + Math.max(0, safeLines.length - 1) * size * lineSpacing,
  };
}

export function alignedLineX(
  left: number,
  width: number,
  lineWidth: number,
  alignment: ParagraphAlignment
): number {
  if (alignment === 'center') return left + (width - lineWidth) / 2;
  if (alignment === 'right') return left + width - lineWidth;
  return left;
}

/** Finds the largest half-point size that keeps the text inside its original block. */
export function fitParagraphSize(
  text: string,
  maxWidth: number,
  maxHeight: number,
  preferredSize: number,
  lineSpacing: number,
  measure: (value: string, size: number) => number,
  minimumSize = 4
): number {
  for (let candidate = preferredSize; candidate >= minimumSize; candidate -= 0.5) {
    const layout = layoutParagraph(
      text,
      maxWidth,
      candidate,
      lineSpacing,
      (value) => measure(value, candidate)
    );
    if (layout.height <= maxHeight + candidate * 0.35) return Math.round(candidate * 10) / 10;
  }
  return minimumSize;
}
