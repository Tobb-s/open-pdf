import { describe, it, expect } from 'vitest';
import {
  boundedScale,
  layerWords,
  recognitionScore,
  unrotatePoint,
  wordsToText,
  type OcrPageResult,
} from '@/lib/ocrAdvanced';
import { extractOcrWords, confidenceSummary } from '@/lib/ocr';
import { stateAt, type Edit } from '@/lib/studio/script';

const word = { text: 'Hola', left: 20, top: 30, right: 100, bottom: 50, confidence: 95 };
describe('advanced local OCR contracts', () => {
  it.each([0, 90, 180, 270] as const)(
    'maps %i degree reading rotation back to original pixels',
    (turn) => {
      const x = 130,
        y = 270,
        w = 600,
        h = 800;
      const rotated =
        turn === 90
          ? [h - y, x]
          : turn === 180
            ? [w - x, h - y]
            : turn === 270
              ? [y, w - x]
              : [x, y];
      expect(unrotatePoint(turn, w, h, rotated[0], rotated[1])).toEqual({ x, y });
    }
  );
  it('retains 300 dpi for a normal A4 page', () =>
    expect(boundedScale(595, 842, 'deep')).toBeCloseTo(300 / 72));
  it('bounds enormous pages by both pixels and side length', () => {
    const scale = boundedScale(8000, 10000, 'deep');
    expect(8000 * 10000 * scale ** 2).toBeLessThanOrEqual(9_000_001);
    expect(10000 * scale).toBeLessThanOrEqual(5000);
  });
  it.each([0, -1, NaN, Infinity])('rejects invalid dimension %s', (width) =>
    expect(() => boundedScale(width, 800, 'deep')).toThrow()
  );
  it('does not prefer a larger volume of low-confidence gibberish', () => {
    expect(recognitionScore(Array(100).fill({ ...word, text: '???', confidence: 99 }))).toBe(0);
    expect(recognitionScore(Array(100).fill(word))).toBeGreaterThan(
      recognitionScore(Array(500).fill({ ...word, confidence: 30 }))
    );
  });
  it('guards nonfinite confidence and coordinates', () => {
    expect(confidenceSummary([NaN, Infinity, -9, 120])).toEqual({ mean: 25, low: 3 });
    const words = extractOcrWords({
      blocks: [
        {
          paragraphs: [
            { lines: [{ words: [{ text: 'x', bbox: { x0: NaN, x1: 4, y0: 1, y1: 4 } }] }] },
          ],
        },
      ],
    });
    expect(words).toEqual([]);
  });
  it('maps OCR layer through crop offset, scale and rotation', () => {
    const result = { words: [word], toPdf: [0, 0.5, 0.5, 0, 10, 20] } as OcrPageResult;
    const layer = layerWords(result, (text, size) => text.length * size * 0.5);
    expect(layer[0]).toMatchObject({ text: 'Hola', x: 35, y: 30, rotate: 90 });
    expect(layer[0].size).toBeGreaterThan(0);
  });
  it('keeps corrections and reading order without guessing names or numbers', () => {
    expect(
      wordsToText([
        word,
        { ...word, text: 'BAZITI', left: 110 },
        { ...word, text: '12345', top: 80, bottom: 100 },
      ])
    ).toBe('Hola BAZITI\n12345');
  });
  it('preserves engine lines despite capitals, accents and unequal glyph heights', () => {
    expect(
      wordsToText([
        { ...word, text: 'ÁRBOL', line: 1 },
        { ...word, text: 'a', top: 44, line: 1 },
        { ...word, text: 'Otro', line: 2 },
      ])
    ).toBe('ÁRBOL a\nOtro');
  });
  it('replaces only Studio OCR on the same page and supports undo', () => {
    const make = (id: string, page: string): Edit => ({
      kind: 'draw',
      mark: { kind: 'ocr', id, page, rotate: 0, words: [] },
    });
    const edits = [make('a', 'o0'), make('b', 'o1'), make('c', 'o0')];
    expect(stateAt(2, edits, 3).marks.map((mark) => mark.id)).toEqual(['b', 'c']);
    expect(stateAt(2, edits, 2).marks.map((mark) => mark.id)).toEqual(['a', 'b']);
  });
});
