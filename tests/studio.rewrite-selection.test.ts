import { describe, expect, it } from 'vitest';
import { selectionToPages, type SelectableHit } from '@/lib/studio/rewriteSelection';

const hits = (...spec: Array<[key: string, page: string]>): SelectableHit[] =>
  spec.map(([key, page]) => ({ key, page }));

describe('turning ticked boxes into pages', () => {
  const found = hits(['a', 'o0'], ['b', 'o0'], ['c', 'o1'], ['d', 'o2']);

  it('says nothing when nothing is ticked', () => {
    expect(selectionToPages(found, new Set())).toEqual({ kind: 'none' });
  });

  it('gives the pages when every match on them is ticked', () => {
    expect(selectionToPages(found, new Set(['a', 'b', 'c']))).toEqual({
      kind: 'pages',
      pages: ['o0', 'o1'],
    });
  });

  it('gives every page when everything is ticked', () => {
    expect(selectionToPages(found, new Set(['a', 'b', 'c', 'd']))).toEqual({
      kind: 'pages',
      pages: ['o0', 'o1', 'o2'],
    });
  });

  it('refuses a page whose matches are only half ticked, and names it', () => {
    // The case this exists for. Replacing «all matches on page o0» when the
    // reader ticked one of two would change a word they deliberately left
    // alone — in a document they are then going to send.
    expect(selectionToPages(found, new Set(['a', 'c']))).toEqual({
      kind: 'partial',
      pages: ['o0'],
    });
  });

  it('refuses as soon as any one page is partial, even if others are whole', () => {
    expect(selectionToPages(found, new Set(['a', 'c', 'd']))).toEqual({
      kind: 'partial',
      pages: ['o0'],
    });
  });

  it('ignores pages nothing was ticked on', () => {
    const result = selectionToPages(found, new Set(['d']));
    expect(result).toEqual({ kind: 'pages', pages: ['o2'] });
  });

  it('counts a single match on a page as a whole page', () => {
    expect(selectionToPages(hits(['solo', 'o5']), new Set(['solo']))).toEqual({
      kind: 'pages',
      pages: ['o5'],
    });
  });

  it('has nothing to do with an empty search', () => {
    expect(selectionToPages([], new Set(['a']))).toEqual({ kind: 'none' });
  });
});
