import { cleanConfidence, type OcrWord, fitFontSize, toWinAnsi } from './ocr';

export type OcrLanguage = 'spa' | 'eng' | 'fra' | 'deu' | 'ita' | 'por';
export type QuarterTurn = 0 | 90 | 180 | 270;
export interface OcrOptions {
  language: OcrLanguage;
  mode: 'quick' | 'deep';
  orientation: 'auto' | QuarterTurn;
  skipText: boolean;
}
export const DEFAULT_OCR_OPTIONS: OcrOptions = {
  language: 'spa',
  mode: 'deep',
  orientation: 'auto',
  skipText: true,
};
export type Matrix = [number, number, number, number, number, number];
export interface OcrPageResult {
  page: number;
  words: OcrWord[];
  text: string;
  width: number;
  height: number;
  toPdf: Matrix;
  orientation: QuarterTurn;
  attempts: number;
  milliseconds: number;
  skipped: boolean;
  preview: string;
  nativeText?: string;
}
export const transformPoint = (m: Matrix, x: number, y: number) => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});

/** Map an upright OCR pixel back to the ORIGINAL displayed bitmap. */
export function unrotatePoint(
  turn: QuarterTurn,
  width: number,
  height: number,
  x: number,
  y: number
) {
  switch (turn) {
    case 90:
      return { x: y, y: height - x };
    case 180:
      return { x: width - x, y: height - y };
    case 270:
      return { x: width - y, y: x };
    default:
      return { x, y };
  }
}

/** This ranks candidates; it is NOT an accuracy estimate. Gibberish volume cannot win alone. */
export function recognitionScore(words: readonly OcrWord[]): number {
  let weight = 0;
  let sum = 0;
  for (const word of words) {
    const letters = (word.text.match(/[\p{L}\p{N}]/gu) ?? []).length;
    const n = Math.min(letters, 12);
    weight += n;
    sum += n * cleanConfidence(word.confidence);
  }
  return weight ? (sum / weight) * Math.min(1, weight / 40) : 0;
}

export function boundedScale(width: number, height: number, mode: OcrOptions['mode']) {
  if (!(width > 0 && height > 0) || !Number.isFinite(width * height))
    throw new Error('Invalid OCR page dimensions');
  return Math.min(
    mode === 'deep' ? 300 / 72 : 216 / 72,
    5000 / Math.max(width, height),
    Math.sqrt(9_000_000 / (width * height))
  );
}

export function layerWords(result: OcrPageResult, measure: (text: string, size: number) => number) {
  const m = result.toPdf;
  const units = Math.hypot(m[0], m[1]);
  const rotate = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  return result.words.flatMap((word) => {
    const text = toWinAnsi(word.text);
    if (!text) return [];
    const point = transformPoint(m, word.left, word.bottom);
    return [{ text, ...point, size: fitFontSize({ ...word, text }, 1 / units, measure), rotate }];
  });
}

/** Keep OCR reading order; a new line is identified geometrically, never spell-corrected. */
export function wordsToText(words: readonly OcrWord[]): string {
  return words
    .map((word, i) => {
      const previous = words[i - 1];
      const newLine =
        previous &&
        (word.line !== undefined && previous.line !== undefined
          ? word.line !== previous.line
          : Math.abs(word.bottom - previous.bottom) >
            Math.max(3, word.bottom - word.top, previous.bottom - previous.top) * 0.6);
      return `${i ? (newLine ? '\n' : ' ') : ''}${word.text}`;
    })
    .join('');
}
