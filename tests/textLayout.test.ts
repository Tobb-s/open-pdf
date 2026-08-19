import { describe, expect, it } from 'vitest';
import { extractParagraphs, toTextFragments, type TextFragment } from '@/lib/textLayout';

const fragment = (partial: Partial<TextFragment> & { str: string }): TextFragment => ({
  x: 0,
  y: 0,
  width: partial.str.length * 5,
  height: 10,
  hasEOL: false,
  ...partial,
});

describe('extractParagraphs', () => {
  it('puts a space where the line break was', () => {
    // The bug this guards: concatenating runs directly produced
    // "Mandelin∗,Mohammad" because the space lived in the line break.
    const paragraphs = extractParagraphs([
      fragment({ str: 'David Mandelin,', y: 100, hasEOL: true }),
      fragment({ str: 'Mohammad Haghighat', y: 88 }),
    ]);

    expect(paragraphs).toEqual(['David Mandelin, Mohammad Haghighat']);
    expect(paragraphs[0]).not.toContain('Mandelin,Mohammad');
  });

  it('spaces runs split mid-line by a wide gap', () => {
    expect(
      extractParagraphs([
        fragment({ str: 'Total', x: 0, width: 30 }),
        fragment({ str: '42', x: 120 }),
      ])
    ).toEqual(['Total 42']);
  });

  it('leaves kerning splits inside a word alone', () => {
    expect(
      extractParagraphs([
        fragment({ str: 'Waterm', x: 0, width: 30 }),
        fragment({ str: 'ark', x: 30.5 }),
      ])
    ).toEqual(['Watermark']);
  });

  it('starts a new paragraph where the leading opens up', () => {
    const paragraphs = extractParagraphs([
      fragment({ str: 'First line of one', y: 200, hasEOL: true }),
      fragment({ str: 'paragraph.', y: 188, hasEOL: true }),
      fragment({ str: 'A separate paragraph.', y: 150, hasEOL: true }),
    ]);

    expect(paragraphs).toEqual(['First line of one paragraph.', 'A separate paragraph.']);
  });

  it('rejoins a word hyphenated across a line break', () => {
    expect(
      extractParagraphs([
        fragment({ str: 'compre-', y: 100, hasEOL: true }),
        fragment({ str: 'hensive', y: 88 }),
      ])
    ).toEqual(['comprehensive']);
  });

  it('keeps a dash that is punctuation, not hyphenation', () => {
    expect(
      extractParagraphs([
        fragment({ str: 'the result —', y: 100, hasEOL: true }),
        fragment({ str: 'and its cause', y: 88 }),
      ])
    ).toEqual(['the result — and its cause']);
  });

  it('breaks lines on a baseline shift even without hasEOL', () => {
    // Multi-column and tabular layouts frequently omit the flag.
    expect(
      extractParagraphs([
        fragment({ str: 'Row one', y: 100 }),
        fragment({ str: 'Row two', y: 86 }),
      ])
    ).toEqual(['Row one Row two']);
  });

  it('returns nothing for a page with no text', () => {
    expect(extractParagraphs([])).toEqual([]);
    expect(extractParagraphs([fragment({ str: '   ' })])).toEqual([]);
  });
});

describe('toTextFragments', () => {
  it('reads geometry out of pdf.js items and skips markers', () => {
    const fragments = toTextFragments([
      { str: 'Hola', transform: [12, 0, 0, 12, 40, 700], width: 24, height: 12, hasEOL: true },
      { type: 'beginMarkedContent' },
      { str: 'mundo', transform: [12, 0, 0, 12, 70, 700], width: 30, height: 12 },
    ]);

    expect(fragments).toHaveLength(2);
    expect(fragments[0]).toEqual({
      str: 'Hola',
      x: 40,
      y: 700,
      width: 24,
      height: 12,
      hasEOL: true,
    });
    expect(fragments[1].hasEOL).toBe(false);
  });

  it('falls back to the transform when height is missing', () => {
    const [only] = toTextFragments([{ str: 'x', transform: [9, 0, 0, 9, 0, 0] }]);
    expect(only.height).toBe(9);
  });
});
