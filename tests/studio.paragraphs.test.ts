import { describe, expect, it } from 'vitest';
import {
  alignedLineX,
  fitParagraphSize,
  groupTextParagraphs,
  layoutParagraph,
} from '@/lib/studio/paragraphs';
import type { FlatTextRun } from '@/lib/studio/textReplacement';

const run = (id: string, text: string, left: number, top: number, width = 42): FlatTextRun => ({
  id,
  text,
  x: left,
  y: 500 - top,
  size: 12,
  rotate: 0,
  visual: { left, top, width, height: 12 },
});

describe('paragraph detection', () => {
  it('groups nearby lines while keeping distant columns separate', () => {
    const paragraphs = groupTextParagraphs([
      run('a', 'Primera línea', 20, 20, 100),
      run('b', 'continúa aquí', 20, 36, 90),
      run('c', 'Otra columna', 250, 20, 100),
      run('d', 'sigue aparte', 250, 36, 90),
    ]);

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs.map((paragraph) => paragraph.text)).toEqual([
      'Primera línea\ncontinúa aquí',
      'Otra columna\nsigue aparte',
    ]);
  });

  it('does not offer rotated runs as paragraph targets', () => {
    expect(groupTextParagraphs([{ ...run('a', 'Vertical', 20, 20), rotate: 90 }])).toEqual([]);
  });

  it('separates a large heading from smaller body text', () => {
    const heading = { ...run('a', 'Título', 20, 20, 100), size: 24 };
    const body = run('b', 'Texto normal', 20, 42, 100);
    expect(groupTextParagraphs([heading, body]).map((paragraph) => paragraph.text)).toEqual([
      'Título',
      'Texto normal',
    ]);
  });
});

describe('paragraph reflow', () => {
  const measure = (value: string) => value.length * 5;

  it('wraps words, preserves explicit line breaks and reports its height', () => {
    const layout = layoutParagraph('uno dos tres\ncuatro', 38, 10, 1.4, measure);
    expect(layout.lines).toEqual(['uno dos', 'tres', 'cuatro']);
    expect(layout.height).toBe(38);
  });

  it('splits a word that is wider than the text box', () => {
    expect(layoutParagraph('ABCDEFGHIJ', 20, 10, 1.2, measure).lines).toEqual(['ABCD', 'EFGH', 'IJ']);
  });

  it('positions lines for all three alignments', () => {
    expect(alignedLineX(20, 100, 40, 'left')).toBe(20);
    expect(alignedLineX(20, 100, 40, 'center')).toBe(50);
    expect(alignedLineX(20, 100, 40, 'right')).toBe(80);
  });

  it('reduces the initial size until the original content fits', () => {
    const fitted = fitParagraphSize('texto ancho', 45, 14, 14, 1.2, (value, size) => value.length * size * 0.5);
    expect(fitted).toBeLessThan(14);
    expect(fitted).toBeGreaterThanOrEqual(4);
  });
});
