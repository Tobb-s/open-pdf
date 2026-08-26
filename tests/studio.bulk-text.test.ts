import { describe, expect, it } from 'vitest';
import { findTextHits, replacementText } from '@/lib/studio/search';
import { stateAt, type Edit, type Mark } from '@/lib/studio/script';
import type { FlatTextRun } from '@/lib/studio/textReplacement';

const run = (id: string, text: string, left: number): FlatTextRun => ({
  id,
  text,
  x: left,
  y: 100,
  size: 12,
  rotate: 0,
  visual: { left, top: 180, width: text.length * 6, height: 14 },
});

describe('whole-document text search', () => {
  const runs = [run('a', 'Contrato', 20), run('b', 'Confidencial', 80), run('c', 'contratos', 170)];

  it('finds a phrase split across PDF text items and retains its rewrite geometry', () => {
    const [hit] = findTextHits(runs, 'contrato confidencial', {
      caseSensitive: false,
      wholeWord: true,
    });

    expect(hit.runIds).toEqual(['a', 'b']);
    expect(hit.text).toBe('Contrato Confidencial');
    expect(hit.visual.left).toBe(20);
    expect(hit.visual.width).toBeGreaterThan(100);
  });

  it('respects case and whole-word boundaries', () => {
    expect(findTextHits(runs, 'contrato', { caseSensitive: true, wholeWord: true })).toEqual([]);
    expect(findTextHits(runs, 'contrato', { caseSensitive: false, wholeWord: true })).toHaveLength(1);
    expect(findTextHits(runs, 'contrato', { caseSensitive: false, wholeWord: false })).toHaveLength(2);
  });

  it('preserves the untouched part of a selected run when replacing a substring', () => {
    const [hit] = findTextHits([run('only', 'ABC-123-Z', 20)], '123', {
      caseSensitive: true,
      wholeWord: false,
    });
    expect(replacementText(hit, '999')).toBe('ABC-999-Z');
  });
});

describe('bulk page rewriting', () => {
  it('rewrites several pages in one undo step', () => {
    const layer = (page: string): Mark => ({
      kind: 'textLayer',
      id: `layer-${page}`,
      page,
      words: [{ text: 'visible', x: 20, y: 20, size: 10, rotate: 0 }],
    });
    const edit: Edit = {
      kind: 'rewritePages',
      pages: [
        { page: 'o0', raster: { asset: 'r0', boxes: [], redactedWords: [] }, marks: [layer('o0')] },
        { page: 'o1', raster: { asset: 'r1', boxes: [], redactedWords: [] }, marks: [layer('o1')] },
      ],
    };

    const before = stateAt(2, [edit], 0);
    const after = stateAt(2, [edit], 1);
    expect(before.pages.every((page) => page.raster === null)).toBe(true);
    expect(after.pages.map((page) => page.raster?.asset)).toEqual(['r0', 'r1']);
    expect(after.marks.map((mark) => mark.id)).toEqual(['layer-o0', 'layer-o1']);
  });
});

