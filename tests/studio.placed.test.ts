import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { materialize } from '@/lib/studio/materialize';
import { stateAt, type Edit } from '@/lib/studio/script';

/**
 * What the build produced, as opposed to what it was asked to produce.
 *
 * Three paths in `materialize` skip a page rather than let it kill the whole
 * build: an asset whose bytes never arrived, an image the file claims to be and
 * is not, and an imported index past the end of its source. Skipping is the
 * right instinct — one bad photo must not cost the reader their afternoon — and
 * it used to happen in silence, with `materialize` handing back only bytes.
 *
 * Everything downstream then counted through `state.pages` and was one out of
 * step from the skipped page onward: the reader drew on a page they were not
 * looking at, and the redaction check read the text of the WRONG page, found
 * none of the painted words in it, and called the document clean. A check that
 * cannot fail is worse than no check.
 */

async function twoNamedPages(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([400, 300]).drawText('PRIMERA', { x: 40, y: 200, size: 18, font });
  doc.addPage([400, 300]).drawText('SEGUNDA', { x: 40, y: 200, size: 18, font });
  return (await doc.save()).slice();
}

/** Claims to be a PNG by its magic bytes and is not one. */
const BROKEN_PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 9, 9, 9, 9]);

describe('what materialize reports it placed', () => {
  it('lists every page when nothing had to be skipped', async () => {
    const original = await twoNamedPages();
    const { pages } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(2, [], 0),
    });
    expect(pages).toEqual(['o0', 'o1']);
  }, 60000);

  it('keeps the document order after a move, not the script order', async () => {
    const original = await twoNamedPages();
    const edits: Edit[] = [{ kind: 'move', page: 'o1', before: 'o0' }];
    const { bytes, pages } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(2, edits, 1),
    });
    expect(pages).toEqual(['o1', 'o0']);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  }, 60000);

  it('omits a page whose asset never arrived', async () => {
    const original = await twoNamedPages();
    const edits: Edit[] = [{ kind: 'insertImages', before: 'o1', assets: ['fantasma'] }];
    const state = stateAt(2, edits, 1);
    expect(state.pages).toHaveLength(3);

    const { bytes, pages } = await materialize({
      original,
      // The asset is not in the map: the page cannot be built.
      assets: new Map(),
      state,
    });

    expect(pages).toEqual(['o0', 'o1']);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    // And the caller can see the difference, which is the whole point.
    expect(state.pages.length - pages.length).toBe(1);
  }, 60000);

  it('THE DEFECT: a broken image no longer shifts the pages after it', async () => {
    // The image is inserted BEFORE the second page. Under the old contract the
    // script said page 2 was the image and page 3 was «SEGUNDA»; the produced
    // document had two pages, so index 2 was past the end and index 1 was
    // «SEGUNDA» rather than the image. Anything mapping id to index was wrong
    // from here on.
    const original = await twoNamedPages();
    const edits: Edit[] = [{ kind: 'insertImages', before: 'o1', assets: ['roto'] }];
    const state = stateAt(2, edits, 1);

    const inserted = state.pages.find((page) => page.id !== 'o0' && page.id !== 'o1');
    expect(inserted).toBeDefined();
    expect(state.pages.map((page) => page.id)).toEqual(['o0', inserted!.id, 'o1']);

    const { bytes, pages } = await materialize({
      original,
      assets: new Map([['roto', BROKEN_PNG]]),
      state,
    });

    // The report matches the document, and the script does not.
    expect(pages).toEqual(['o0', 'o1']);
    const produced = await PDFDocument.load(bytes);
    expect(produced.getPageCount()).toBe(2);

    // The page at index 1 is «SEGUNDA», and `pages` says so; the script would
    // have said the id of the image that was never built.
    expect(pages[1]).toBe('o1');
    expect(state.pages[1].id).toBe(inserted!.id);
  }, 60000);

  it('an untouched document reports its pages too', async () => {
    // The short circuit hands back the original bytes without building
    // anything, and still has to answer the question.
    const original = await twoNamedPages();
    const { bytes, pages } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(2, [], 0),
    });
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(original))).toBe(0);
    expect(pages).toEqual(['o0', 'o1']);
  }, 60000);

  it('omits a deleted page', async () => {
    const original = await twoNamedPages();
    const { pages } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(2, [{ kind: 'delete', page: 'o0' }], 1),
    });
    expect(pages).toEqual(['o1']);
  }, 60000);
});
