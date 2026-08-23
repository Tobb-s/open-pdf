import { describe, expect, it } from 'vitest';
import { assetsReferencedBy } from '@/lib/studio/store';
import type { Edit, Mark } from '@/lib/studio/script';

/**
 * Which bytes a saved session has to carry.
 *
 * This filter has been wrong twice, and both times the same way: an edit that
 * carries bytes was added and the filter was not. The first time, inserted
 * image pages came back blank after a resume. The second time — worse — a
 * redacted page came back UN-redacted, and for a scanned page there is no text
 * under the box for the export check to look for, so it would have called the
 * file clean and handed over the untouched scan.
 *
 * So this file is deliberately one test per kind of edit rather than one test
 * for the happy path. A kind that carries bytes and is not here is the defect.
 */

const IMAGE_MARK: Mark = {
  kind: 'image',
  id: 'm1',
  page: 'o0',
  x: 10,
  y: 10,
  width: 100,
  height: 100,
  asset: 'firma',
  opacity: 1,
};

describe('assetsReferencedBy', () => {
  it('keeps the bytes of inserted pages', () => {
    const edits: Edit[] = [{ kind: 'insert', before: null, asset: 'otro-pdf', indices: [0, 1] }];
    expect([...assetsReferencedBy(edits)]).toEqual(['otro-pdf']);
  });

  it('keeps the bytes of every inserted image, not just the first', () => {
    const edits: Edit[] = [{ kind: 'insertImages', before: null, assets: ['a', 'b', 'c'] }];
    expect([...assetsReferencedBy(edits)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps the bytes of a stamped image', () => {
    const edits: Edit[] = [{ kind: 'draw', mark: IMAGE_MARK }];
    expect([...assetsReferencedBy(edits)]).toEqual(['firma']);
  });

  it('THE ONE THAT WAS MISSING: keeps the bitmap a redacted page became', () => {
    // Without this the saved session held the redaction edit and none of its
    // bytes. On resume the page rebuilt from the original — un-redacted — while
    // the sidebar said «Guardado en este navegador».
    const edits: Edit[] = [
      {
        kind: 'raster',
        page: 'o0',
        raster: { asset: 'tachado', boxes: [{ x: 1, y: 2, width: 3, height: 4 }] },
      },
    ];
    expect([...assetsReferencedBy(edits)]).toEqual(['tachado']);
  });

  it('keeps the bitmap of a page merely turned into an image, with nothing painted out', () => {
    const edits: Edit[] = [
      { kind: 'raster', page: 'o0', raster: { asset: 'plana', boxes: [] } },
    ];
    expect([...assetsReferencedBy(edits)]).toEqual(['plana']);
  });

  it('asks for nothing when a raster is taken back', () => {
    const edits: Edit[] = [{ kind: 'raster', page: 'o0', raster: null }];
    expect([...assetsReferencedBy(edits)]).toEqual([]);
  });

  it('names nothing for the edits that carry no bytes', () => {
    // Every remaining kind in the union, so that adding one and forgetting it
    // shows up here as well as at the compiler.
    const edits: Edit[] = [
      { kind: 'rotate', page: 'o0', turns: 1 },
      { kind: 'delete', page: 'o1' },
      { kind: 'move', page: 'o2', before: null },
      { kind: 'crop', page: 'o0', box: { x: 0, y: 0, width: 10, height: 10 } },
      { kind: 'erase', markId: 'm1' },
      { kind: 'setField', field: 'nombre', value: 'Ana' },
      { kind: 'metadata', patch: { title: 'x' } },
      { kind: 'watermark', spec: null },
      { kind: 'numbering', spec: null },
      { kind: 'flattenForms', on: true },
    ];
    expect([...assetsReferencedBy(edits)]).toEqual([]);
  });

  it('scans the whole list, so redo after a resume still has its bytes', () => {
    // The cursor is deliberately not consulted: an edit past it can be redone,
    // and dropping its bytes would make redo produce a different document than
    // the one the reader undid.
    const edits: Edit[] = [
      { kind: 'draw', mark: IMAGE_MARK },
      { kind: 'raster', page: 'o1', raster: { asset: 'tachado', boxes: [] } },
    ];
    expect([...assetsReferencedBy(edits)].sort()).toEqual(['firma', 'tachado']);
  });

  it('says each asset once, however many edits name it', () => {
    const edits: Edit[] = [
      { kind: 'insertImages', before: null, assets: ['a', 'a'] },
      { kind: 'draw', mark: { ...IMAGE_MARK, asset: 'a' } as Mark },
    ];
    expect([...assetsReferencedBy(edits)]).toEqual(['a']);
  });
});
