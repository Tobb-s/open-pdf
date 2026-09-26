import type { Segment } from './contracts';
export interface Box { x: number; y: number; width: number; height: number }
export interface TextRun extends Box {
  text: string; size: number; font: string; confidence?: number;
  /** Recognition-line identity. Native PDF spans have no OCR line identity. */
  line?: number;
}
export interface TranslationBlock extends Box {
  id: string; source: string; translated: string; size: number; font: string;
  confidence?: number; included: boolean;
  /** Session-only provenance. Never part of a translation/context payload. */
  aiReview?: {
    original: string; source: string; proposal?: string; model: string;
    status: 'applied' | 'unresolved' | 'failed'; reason?: string;
  };
  /** Original line rectangles; erase only ink areas, not whole paragraph whitespace. */
  lines: Box[];
}
export interface TranslationPage {
  number: number; width: number; height: number; method: 'native' | 'ocr';
  blocks: TranslationBlock[]; warnings: string[];
}
const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;
/** Long words in narrow, tall boxes are sideways labels, not upright font metrics. */
export function isVerticalOcrRun(run: TextRun) {
  return run.line !== undefined && (run.text.match(/\p{L}/gu)?.length ?? 0) >= 3 &&
    run.height > run.width * 1.4;
}
export function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(right(a), right(b)) - x, height: Math.max(bottom(a), bottom(b)) - y };
}

/** Conservative spatial grouping: large horizontal gaps (tables/columns) stay separate. */
export function groupRuns(runs: TextRun[], pageNumber: number): TranslationBlock[] {
  const lines: TextRun[] = [];
  // Cluster vertical bands first, then order words left-to-right. Sorting every
  // word by its top edge scrambles OCR words whose ascenders differ by 1-2px.
  const bands: TextRun[][] = [];
  const recognized = new Map<number, TextRun[]>();
  const valid = runs.filter(run => run.text.trim() &&
    [run.x, run.y, run.width, run.height, run.size].every(Number.isFinite) &&
    run.width > 0 && run.height > 0 && run.size > 0);
  for (const run of [...valid].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (run.line !== undefined) {
      const band = recognized.get(run.line) ?? [];
      band.push(run); recognized.set(run.line, band);
      continue;
    }
    const band = bands.findLast(items => Math.abs(items[0].y - run.y) < Math.min(items[0].height, run.height) * 0.4);
    if (band) band.push(run); else bands.push([run]);
  }
  for (const band of recognized.values()) {
    // A robust upper quartile ignores tiny punctuation/x-height-only words.
    // `size` is ink height for OCR; ink usually occupies about 3/4 of an em.
    const letters = band.filter(r => (r.text.match(/\p{L}/gu)?.length ?? 0) >= 2);
    const heights = (letters.length ? letters : band).map(r => r.size).sort((a, b) => a - b);
    const size = heights[Math.floor((heights.length - 1) * 0.75)] / 0.75;
    bands.push(band.map(r => ({ ...r, size })));
  }
  for (const band of bands) {
    let line: TextRun | undefined;
    for (const run of band.sort((a, b) => a.x - b.x)) {
      const gap = line ? run.x - right(line) : Infinity;
      // A recognized line can still span a large table/column gap. Never bridge it.
      if (line && gap >= -1 && gap < Math.max(line.size, run.size) * 1.6) {
        const separated = run.line !== undefined || gap > run.size * 0.15;
        line.text += (separated && !line.text.endsWith(' ') ? ' ' : '') + run.text;
        Object.assign(line, union(line, run));
        if (run.confidence !== undefined) line.confidence = Math.min(line.confidence ?? 100, run.confidence);
      } else { line = { ...run }; lines.push(line); }
    }
  }
  const blocks: TranslationBlock[] = [];
  const ocrBlocks = new Set<string>();
  for (const line of lines.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const candidate = blocks.findLast(b => {
      const ocr = line.line !== undefined && ocrBlocks.has(b.id);
      // Scanned double-spaced prose often has an indented first line and
      // variable ink heights. Translate paragraphs, not disconnected lines.
      // Positive indentation starts a new paragraph; large gutters stay split.
      const aligned = ocr ? line.x - b.x > -Math.max(b.size, line.size) * 3.5 &&
        line.x - b.x < line.size * 0.7 : Math.abs(b.x - line.x) < line.size * 0.7;
      const sameSize = ocr ? Math.abs(b.size - line.size) <= Math.min(b.size, line.size) * 0.3
        : Math.abs(b.size - line.size) < 1.5;
      return aligned && sameSize && b.font === line.font &&
      line.y >= bottom(b) - 1 && line.y - bottom(b) < line.size * (ocr ? 1.3 : 0.65) &&
      // A very short previous line is often a heading/caption/paragraph ending.
      b.lines[b.lines.length - 1].width > Math.max(b.width, line.width) * 0.65 &&
      b.source.length + line.text.length < 10_000;
    });
    const box = { x: line.x, y: line.y, width: line.width, height: line.height };
    if (candidate) {
      candidate.source += (candidate.source.endsWith('-') ? '\n' : ' ') + line.text.trim();
      candidate.lines.push(box);
      Object.assign(candidate, union(candidate, line));
      if (line.confidence !== undefined) candidate.confidence = Math.min(candidate.confidence ?? 100, line.confidence);
    } else {
      const id = `p${pageNumber}_b${blocks.length + 1}`;
      blocks.push({ ...box, id, source: line.text.trim(), translated: '', size: line.size,
        font: line.font, confidence: line.confidence, included: true, lines: [box] });
      if (line.line !== undefined) ocrBlocks.add(id);
    }
  }
  return blocks;
}

export function pendingSegments(pages: TranslationPage[]): Segment[] {
  return pages.flatMap(p => p.blocks.filter(b => b.included && !b.translated.trim())
    .map(b => ({ id: b.id, text: b.source })));
}

/** Fit without horizontal distortion, silent clipping, ellipses or shrinking below 7pt. */
export function fitBlock(text: string, box: Box, preferred: number, measure: (s: string, size: number) => number, minimum = 7) {
  const max = Math.max(minimum, Math.min(48, preferred));
  for (let size = max; size >= minimum - 0.01; size -= 0.25) {
    const lines: string[] = [];
    let failed = false;
    for (const paragraph of text.replace(/\r/g, '').split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (measure(word, size) > box.width) { failed = true; break; }
        const next = line ? `${line} ${word}` : word;
        if (measure(next, size) <= box.width) line = next;
        else { lines.push(line); line = word; }
      }
      if (failed) break;
      lines.push(line);
    }
    if (!failed && lines.length * size * 1.08 <= box.height + 0.1) return { size, lines, lineHeight: size * 1.08 };
  }
  return null;
}
