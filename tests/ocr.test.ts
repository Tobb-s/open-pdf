import { describe, expect, it } from 'vitest';
import { extractOcrWords, fitFontSize, RECOGNIZE_OUTPUT, toWinAnsi } from '@/lib/ocr';

/**
 * The shape tesseract.js 7 actually returns when `blocks: true` is requested.
 *
 * This is the regression that shipped: the code read `data.words`, which does not
 * exist on the result at all, so the invisible text layer was never drawn and the
 * "searchable" PDF contained no text.
 */
const RESULT_WITH_BLOCKS = {
  text: 'Hola mundo',
  blocks: [
    {
      paragraphs: [
        {
          lines: [
            {
              words: [
                { text: 'Hola', bbox: { x0: 20, y0: 30, x1: 120, y1: 78 }, confidence: 96 },
                { text: 'mundo', bbox: { x0: 132, y0: 30, x1: 280, y1: 78 }, confidence: 94 },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** What `recognize()` returns with default options — note there is no `words`. */
const RESULT_WITHOUT_BLOCKS = { text: 'Hola mundo', blocks: null };

describe('RECOGNIZE_OUTPUT', () => {
  it('asks for blocks, without which no words come back', () => {
    expect(RECOGNIZE_OUTPUT.blocks).toBe(true);
    expect(RECOGNIZE_OUTPUT.text).toBe(true);
  });
});

describe('extractOcrWords', () => {
  it('walks blocks → paragraphs → lines → words', () => {
    const words = extractOcrWords(RESULT_WITH_BLOCKS);

    expect(words.map((word) => word.text)).toEqual(['Hola', 'mundo']);
    expect(words[0]).toMatchObject({ left: 20, top: 30, right: 120, bottom: 78 });
  });

  it('returns nothing when blocks were not requested', () => {
    // Guards the failure mode directly: if a future change stops passing
    // RECOGNIZE_OUTPUT, the text layer is empty and the caller must notice.
    expect(extractOcrWords(RESULT_WITHOUT_BLOCKS)).toEqual([]);
  });

  it('never reads a `words` property off the result', () => {
    const decoy = { ...RESULT_WITHOUT_BLOCKS, words: [{ text: 'trap', bbox: {} }] };
    expect(extractOcrWords(decoy)).toEqual([]);
  });

  it('skips words with no text or an unusable box', () => {
    const messy = {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  words: [
                    { text: '   ', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
                    { text: 'ok', bbox: { x0: 5, y0: 5, x1: 4, y1: 20 } }, // inverted
                    { text: 'good', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(extractOcrWords(messy).map((word) => word.text)).toEqual(['good']);
  });

  it('tolerates a malformed tree instead of throwing', () => {
    expect(extractOcrWords({})).toEqual([]);
    expect(extractOcrWords({ blocks: [{}] })).toEqual([]);
    expect(extractOcrWords({ blocks: [{ paragraphs: [{ lines: [{}] }] }] })).toEqual([]);
  });
});

describe('fitFontSize', () => {
  const word = { text: 'Hola', left: 0, top: 0, right: 100, bottom: 40, confidence: 90 };

  it('scales the size so the invisible word matches the printed width', () => {
    // At scale 2 the word is 50pt wide. A font measuring 25pt at size 16 needs
    // to double to cover it.
    const size = fitFontSize(word, 2, () => 25);
    expect(size).toBeCloseTo(32, 5);
  });

  it('stays within sight of the glyph height when a measurement is absurd', () => {
    const boxHeight = 40 / 2;
    expect(fitFontSize(word, 2, () => 0.0001)).toBeLessThanOrEqual(boxHeight * 1.6);
    expect(fitFontSize(word, 2, () => 1e9)).toBeGreaterThanOrEqual(boxHeight * 0.3);
  });
});

describe('toWinAnsi', () => {
  it('keeps the accented Latin characters the standard fonts support', () => {
    expect(toWinAnsi('mañana café ¿qué?')).toBe('mañana café ¿qué?');
    expect(toWinAnsi('Größe Ünïcode')).toBe('Größe Ünïcode');
  });

  it('drops what the standard fonts would throw on', () => {
    // pdf-lib's Helvetica cannot encode these, and the old code lost the whole
    // word to a swallowed exception rather than just the character.
    expect(toWinAnsi('日本語')).toBe('');
    expect(toWinAnsi('precio→10')).toBe('precio10');
  });
});
