/**
 * Pulls the recognised words, with their positions, out of a tesseract.js result.
 *
 * tesseract.js 7 does not put a `words` array on the result. Words live inside
 * `blocks → paragraphs → lines → words`, and `blocks` is `null` unless the caller
 * asks for it explicitly — which is why the previous `data.words || []` was always
 * empty and the "searchable" PDF came out with no text layer at all.
 *
 * `RECOGNIZE_OUTPUT` is the request that makes `blocks` appear; pass it as the
 * third argument to `worker.recognize`.
 */

export const RECOGNIZE_OUTPUT = { text: true, blocks: true } as const;

export interface OcrWord {
  text: string;
  /** Pixel coordinates in the image that was recognised. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  confidence: number;
}

interface RecognizeLike {
  blocks?: unknown;
}

interface BoxLike {
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
}

interface WordLike {
  text?: string;
  bbox?: BoxLike;
  confidence?: number;
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * Walks the block tree and returns every word with a usable box.
 *
 * Written defensively on purpose: an empty result here is indistinguishable from
 * "this page had no text", so `extractOcrWords` is covered by tests that assert a
 * known tree yields known words. That is the guard the original code lacked.
 */
export function extractOcrWords(data: RecognizeLike): OcrWord[] {
  const words: OcrWord[] = [];

  for (const block of asArray(data?.blocks)) {
    for (const paragraph of asArray((block as { paragraphs?: unknown })?.paragraphs)) {
      for (const line of asArray((paragraph as { lines?: unknown })?.lines)) {
        for (const raw of asArray((line as { words?: unknown })?.words)) {
          const word = raw as WordLike;
          const text = typeof word.text === 'string' ? word.text.trim() : '';
          const box = word.bbox;

          if (text === '' || !box) continue;
          const { x0, y0, x1, y1 } = box;
          if (
            typeof x0 !== 'number' ||
            typeof y0 !== 'number' ||
            typeof x1 !== 'number' ||
            typeof y1 !== 'number' ||
            x1 <= x0 ||
            y1 <= y0
          ) {
            continue;
          }

          words.push({
            text,
            left: x0,
            top: y0,
            right: x1,
            bottom: y1,
            confidence: typeof word.confidence === 'number' ? word.confidence : 0,
          });
        }
      }
    }
  }

  return words;
}

/**
 * Chooses a font size that makes an invisible word occupy roughly the width of
 * the printed word underneath it, so text selection lines up with what is seen.
 */
export function fitFontSize(
  word: OcrWord,
  scale: number,
  measure: (text: string, size: number) => number
): number {
  const targetWidth = (word.right - word.left) / scale;
  const boxHeight = (word.bottom - word.top) / scale;
  const startingSize = Math.max(boxHeight * 0.8, 1);

  const naturalWidth = measure(word.text, startingSize);
  if (naturalWidth <= 0) return startingSize;

  const fitted = startingSize * (targetWidth / naturalWidth);
  // Keep it within sight of the glyph height so an odd measurement cannot produce
  // an absurd size.
  return Math.min(Math.max(fitted, boxHeight * 0.3), boxHeight * 1.6);
}

/**
 * Drops characters the PDF standard fonts cannot encode.
 *
 * pdf-lib's built-in fonts are WinAnsi only and throw on anything outside it.
 * The previous code swallowed that exception per word, which quietly removed
 * whole words from the text layer; stripping the offending characters keeps the
 * rest of the word searchable.
 */
/** Everything outside the WinAnsi repertoire the PDF standard fonts support. */
const WIN_ANSI_UNSUPPORTED =
  /[^ -~ -ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g;

export function toWinAnsi(text: string): string {
  return text.replace(WIN_ANSI_UNSUPPORTED, '');
}
