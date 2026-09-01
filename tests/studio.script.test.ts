import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { materialize } from '@/lib/studio/materialize';
import {
  append,
  initialState,
  isUntouched,
  ORIGINAL,
  stateAt,
  type Edit,
  type Mark,
  type ScriptState,
} from '@/lib/studio/script';
import { buildRichPdf, pageWidth } from './helpers/richPdf';

let fixture: Uint8Array;
let imported: Uint8Array;
const PAGES = 5;
const noAssets = new Map<string, Uint8Array>();

/** A 1x1 PNG, enough to exercise the image-mark path. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (character) => character.charCodeAt(0)
);

beforeAll(async () => {
  fixture = await buildRichPdf(PAGES);
  const extra = await PDFDocument.create();
  extra.addPage([333, 444]);
  extra.addPage([555, 666]);
  imported = (await extra.save()).slice();
});

const page = (index: number) => `o${index}`;

const textMark = (id: string, pageIndex: number, text: string): Mark => ({
  kind: 'text',
  id,
  page: page(pageIndex),
  x: 40,
  y: 120,
  text,
  size: 14,
  color: { r: 0, g: 0, b: 0 },
  rotate: 0,
  font: { family: 'helvetica', bold: false, italic: false },
});

const assetsFor = () =>
  new Map<string, Uint8Array>([
    ['deck', imported],
    ['logo', PNG],
  ]);

/**
 * Twenty edits covering every kind the script supports — including the two the
 * gate used to skip, `insert` and an image mark, which are exactly the ones
 * that pull foreign page trees and embedded images into the document and so are
 * the hardest for undo to unwind.
 */
function twentyEdits(): Edit[] {
  return [
    { kind: 'rotate', page: page(0), turns: 1 },
    { kind: 'rotate', page: page(1), turns: 2 },
    { kind: 'move', page: page(4), before: page(0) },
    { kind: 'draw', mark: textMark('m1', 2, 'uno') },
    { kind: 'crop', page: page(3), box: { x: 20, y: 20, width: 300, height: 400 } },
    { kind: 'insert', before: page(2), asset: 'deck', indices: [0, 1] },
    { kind: 'draw', mark: textMark('m2', 0, 'dos') },
    {
      kind: 'draw',
      mark: {
        kind: 'image',
        id: 'm3',
        page: page(0),
        asset: 'logo',
        x: 30,
        y: 30,
        width: 60,
        height: 60,
        opacity: 0.8,
      },
    },
    { kind: 'delete', page: page(2) },
    { kind: 'rotate', page: page(3), turns: 3 },
    { kind: 'move', page: page(0), before: null },
    {
      kind: 'draw',
      mark: {
        kind: 'rect',
        id: 'm4',
        page: page(1),
        x: 50,
        y: 50,
        width: 120,
        height: 60,
        color: { r: 1, g: 0.9, b: 0.2 },
        borderColor: { r: 0, g: 0, b: 0 },
        borderWidth: 1,
        opacity: 0.6,
      },
    },
    { kind: 'rotate', page: page(4), turns: 1 },
    // m2 sits on page 0, which survives every deletion above — so this really
    // erases something. The version of this list that pointed at a mark on an
    // already-deleted page left `erase` with no coverage at all.
    { kind: 'erase', markId: 'm2' },
    { kind: 'crop', page: page(0), box: { x: 0, y: 0, width: 200, height: 200 } },
    {
      kind: 'draw',
      mark: {
        kind: 'ink',
        id: 'm5',
        page: page(3),
        points: [
          [30, 30],
          [80, 90],
          [140, 60],
        ],
        color: { r: 0.1, g: 0.2, b: 0.8 },
        width: 2,
      },
    },
    { kind: 'move', page: page(3), before: page(1) },
    { kind: 'crop', page: page(3), box: null },
    { kind: 'rotate', page: page(0), turns: 3 },
    { kind: 'delete', page: page(1) },
  ];
}

/**
 * An independent reading of the same edits, written from the specification
 * rather than from the implementation.
 *
 * `expect(stateAt(x)).toEqual(stateAt(x))` is a tautology: it passes for any
 * deterministic function, including one that replays incrementally from a
 * hidden cache — which is precisely the thing the purity test is supposed to
 * catch. Comparing against a second, separately written fold is not.
 */
function referenceState(pageCount: number, edits: readonly Edit[], cursor: number): ScriptState {
  const pages = Array.from({ length: pageCount }, (_, index) => ({
    id: `o${index}`,
    origin: { asset: ORIGINAL, index },
    turns: 0,
    crop: null as null | { x: number; y: number; width: number; height: number },
    raster: null,
    rewrites: [] as ScriptState['pages'][number]['rewrites'],
  }));
  let marks: Mark[] = [];

  for (let step = 0; step < Math.min(cursor, edits.length); step += 1) {
    const edit = edits[step];
    const indexOf = (id: string) => pages.findIndex((entry) => entry.id === id);

    if (edit.kind === 'rotate') {
      const at = indexOf(edit.page);
      if (at !== -1) pages[at].turns = (((pages[at].turns + edit.turns) % 4) + 4) % 4;
    } else if (edit.kind === 'crop') {
      const at = indexOf(edit.page);
      if (at !== -1) pages[at].crop = edit.box;
    } else if (edit.kind === 'delete') {
      const at = indexOf(edit.page);
      if (at !== -1 && pages.length > 1) {
        pages.splice(at, 1);
        marks = marks.filter((mark) => mark.page !== edit.page);
      }
    } else if (edit.kind === 'move') {
      const at = indexOf(edit.page);
      if (at !== -1) {
        const [moved] = pages.splice(at, 1);
        const anchor = edit.before === null ? pages.length : indexOf(edit.before);
        if (anchor === -1) pages.splice(at, 0, moved);
        else pages.splice(anchor, 0, moved);
      }
    } else if (edit.kind === 'insert') {
      const added = edit.indices.map((index) => ({
        id: `i${step}:${edit.asset}:${index}`,
        origin: { asset: edit.asset, index },
        turns: 0,
        crop: null,
        raster: null,
        rewrites: [],
      }));
      if (added.length > 0) {
        const anchor = edit.before === null ? pages.length : indexOf(edit.before);
        pages.splice(anchor === -1 ? pages.length : anchor, 0, ...added);
      }
    } else if (edit.kind === 'draw') {
      if (pages.some((entry) => entry.id === edit.mark.page)) marks = [...marks, edit.mark];
    } else if (edit.kind === 'erase') {
      marks = marks.filter((mark) => mark.id !== edit.markId);
    }
  }

  return {
    pages,
    marks,
    flattenForms: false,
    fields: {},
    metadata: {},
    watermark: null,
    numbering: null,
    sanitize: null,
  };
}

describe('the edit script', () => {
  it('covers every edit kind in twenty steps', () => {
    const edits = twentyEdits();
    expect(edits).toHaveLength(20);
    const kinds = new Set(edits.map((edit) => edit.kind));
    expect([...kinds].sort()).toEqual(
      ['crop', 'delete', 'draw', 'erase', 'insert', 'move', 'rotate'].sort()
    );
    const markKinds = new Set(
      edits.flatMap((edit) => (edit.kind === 'draw' ? [edit.mark.kind] : []))
    );
    expect([...markKinds].sort()).toEqual(['image', 'ink', 'rect', 'text']);
  });

  it('agrees with an independently written reading of the same edits', () => {
    // The real purity check: a second implementation, not a second call.
    const edits = twentyEdits();
    for (let cursor = 0; cursor <= edits.length; cursor += 1) {
      const mine = stateAt(PAGES, edits, cursor);
      const theirs = referenceState(PAGES, edits, cursor);
      expect(
        mine.pages.map((entry) => entry.id),
        `orden en ${cursor}`
      ).toEqual(theirs.pages.map((entry) => entry.id));
      expect(
        mine.pages.map((entry) => entry.turns),
        `giros en ${cursor}`
      ).toEqual(theirs.pages.map((entry) => entry.turns));
      expect(
        mine.marks.map((mark) => mark.id),
        `marcas en ${cursor}`
      ).toEqual(theirs.marks.map((mark) => mark.id));
    }
  });

  it('gives the same answer whichever order the cursors are asked for', () => {
    // A version that replayed incrementally from a cache would pass a
    // forwards-only comparison and fail this one.
    const edits = twentyEdits();
    const forwards: ScriptState[] = [];
    for (let cursor = 0; cursor <= edits.length; cursor += 1) {
      forwards.push(stateAt(PAGES, edits, cursor));
    }
    const backwards: ScriptState[] = [];
    for (let cursor = edits.length; cursor >= 0; cursor -= 1) {
      backwards[cursor] = stateAt(PAGES, edits, cursor);
    }
    expect(backwards).toEqual(forwards);
  });

  it('hands back a state nobody else holds a reference to', () => {
    const edits = twentyEdits();
    const first = stateAt(PAGES, edits, 6);
    first.pages.length = 0;
    first.marks.length = 0;
    expect(stateAt(PAGES, edits, 6).pages.length).toBeGreaterThan(0);
  });

  it('an edit naming a page that is gone changes nothing', () => {
    const edits: Edit[] = [
      { kind: 'delete', page: page(1) },
      { kind: 'rotate', page: page(1), turns: 1 },
      { kind: 'crop', page: page(1), box: { x: 0, y: 0, width: 10, height: 10 } },
      { kind: 'draw', mark: textMark('ghost', 1, 'fantasma') },
    ];
    const after = stateAt(PAGES, edits, 4);
    expect(after.pages).toHaveLength(PAGES - 1);
    expect(after.marks).toHaveLength(0);
  });

  it('places a move and an insert by page, so a stale index cannot misplace them', () => {
    // The defect this replaced: positions were indices read off a screen that
    // trails the script, so deleting a page and then importing "here" put the
    // import on the wrong side of the page the reader was pointing at.
    const edits: Edit[] = [
      { kind: 'delete', page: page(0) },
      { kind: 'insert', before: page(3), asset: 'deck', indices: [0] },
    ];
    const after = stateAt(PAGES, edits, 2);
    expect(after.pages.map((entry) => entry.id)).toEqual([
      'o1',
      'o2',
      'i1:deck:0',
      'o3',
      'o4',
    ]);
  });

  it('leaves a page alone when the page it was to move before is gone', () => {
    const edits: Edit[] = [
      { kind: 'delete', page: page(2) },
      { kind: 'move', page: page(4), before: page(2) },
    ];
    const after = stateAt(PAGES, edits, 2);
    expect(after.pages.map((entry) => entry.id)).toEqual(['o0', 'o1', 'o3', 'o4']);
  });

  it('moves a page to the end when no anchor is given', () => {
    const after = stateAt(PAGES, [{ kind: 'move', page: page(0), before: null }], 1);
    expect(after.pages.map((entry) => entry.id)).toEqual(['o1', 'o2', 'o3', 'o4', 'o0']);
  });

  it('deleting a page takes its marks with it, so undo brings both back', () => {
    const edits: Edit[] = [
      { kind: 'draw', mark: textMark('m', 2, 'nota') },
      { kind: 'delete', page: page(2) },
    ];
    expect(stateAt(PAGES, edits, 1).marks).toHaveLength(1);
    expect(stateAt(PAGES, edits, 2).marks).toHaveLength(0);
    expect(stateAt(PAGES, edits, 1).marks).toHaveLength(1);
  });

  it('erase really removes a mark from a page that survives', () => {
    const edits: Edit[] = [
      { kind: 'draw', mark: textMark('keep', 0, 'queda') },
      { kind: 'draw', mark: textMark('gone', 0, 'se va') },
      { kind: 'erase', markId: 'gone' },
    ];
    expect(stateAt(PAGES, edits, 2).marks.map((mark) => mark.id)).toEqual(['keep', 'gone']);
    expect(stateAt(PAGES, edits, 3).marks.map((mark) => mark.id)).toEqual(['keep']);
  });

  it('refuses to delete the last page', () => {
    const edits: Edit[] = Array.from({ length: PAGES }, (_, index) => ({
      kind: 'delete' as const,
      page: page(index),
    }));
    expect(stateAt(PAGES, edits, PAGES).pages).toHaveLength(1);
  });

  it('brings a page back to where it started after four quarter turns', () => {
    // Without the mod-4 normalisation the page reads as turned by four, the
    // document counts as touched, and a file that should have come back
    // untouched gets re-encoded instead.
    const edits: Edit[] = Array.from({ length: 4 }, () => ({
      kind: 'rotate' as const,
      page: page(0),
      turns: 1,
    }));
    expect(stateAt(PAGES, edits, 4).pages[0].turns).toBe(0);
    expect(isUntouched(stateAt(PAGES, edits, 4), PAGES)).toBe(true);
  });

  it('appending after an undo drops what was undone', () => {
    const edits = twentyEdits();
    const result = append(edits, 5, { kind: 'rotate', page: page(0), turns: 1 });
    expect(result.edits).toHaveLength(6);
    expect(result.cursor).toBe(6);
  });

  it('recognises an untouched document', () => {
    const edits = twentyEdits();
    expect(isUntouched(stateAt(PAGES, edits, 0), PAGES)).toBe(true);
    expect(isUntouched(stateAt(PAGES, edits, 1), PAGES)).toBe(false);
  });
});

describe('materialise', () => {
  it('THE STAGE GATE: twenty edits, twenty undos, and the file comes back byte for byte', async () => {
    const edits = twentyEdits();
    const assets = assetsFor();

    const { bytes: edited } = await materialize({
      original: fixture,
      assets,
      state: stateAt(PAGES, edits, 20),
    });
    expect(Array.from(edited)).not.toEqual(Array.from(fixture));

    const { bytes: undone } = await materialize({
      original: fixture,
      assets,
      state: stateAt(PAGES, edits, 0),
    });

    expect(undone.byteLength).toBe(fixture.byteLength);
    expect(Array.from(undone)).toEqual(Array.from(fixture));
  });

  it('really applied all twenty: imported pages and an embedded image are in there', async () => {
    // Without this the gate could pass on a script whose hardest edits silently
    // did nothing.
    const { PDFStream } = await import('pdf-lib');
    const { bytes: edited } = await materialize({
      original: fixture,
      assets: assetsFor(),
      state: stateAt(PAGES, twentyEdits(), 20),
    });
    const out = await PDFDocument.load(edited);

    const widths = out.getPages().map((entry) => Math.round(entry.getWidth()));
    expect(widths).toContain(333);
    expect(widths).toContain(555);

    const images = out.context
      .enumerateIndirectObjects()
      .filter(
        ([, object]) =>
          object instanceof PDFStream &&
          object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
      );
    expect(images.length).toBeGreaterThan(0);
  });

  it('materialising twice from the same cursor gives the same bytes', async () => {
    const edits = twentyEdits();
    const assets = assetsFor();
    for (const cursor of [3, 11, 20]) {
      const { bytes: once } = await materialize({
        original: fixture,
        assets,
        state: stateAt(PAGES, edits, cursor),
      });
      const { bytes: twice } = await materialize({
        original: fixture,
        assets,
        state: stateAt(PAGES, edits, cursor),
      });
      expect(Array.from(twice), `cursor ${cursor}`).toEqual(Array.from(once));
    }
  });

  it('does not take the untouched shortcut when a trailing page was deleted', async () => {
    // The shortcut compares the state against the number of ORIGINAL pages in
    // it, which after deleting the last page is one fewer — so without the
    // re-check against the loaded document the reader would be handed back the
    // file they were trying to change.
    const { bytes: out } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, [{ kind: 'delete', page: page(PAGES - 1) }], 1),
    });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(PAGES - 1);
    expect(Array.from(out)).not.toEqual(Array.from(fixture));
  });

  it('applies order, rotation and deletion the way the script says', async () => {
    const edits: Edit[] = [
      { kind: 'move', page: page(4), before: page(0) },
      { kind: 'rotate', page: page(0), turns: 1 },
      { kind: 'delete', page: page(2) },
    ];
    const { bytes } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, edits, 3),
    });
    const out = await PDFDocument.load(bytes);

    expect(out.getPages().map((entry) => entry.getWidth())).toEqual([4, 0, 1, 3].map(pageWidth));
    expect(out.getPages().map((entry) => entry.getRotation().angle)).toEqual([0, 90, 0, 0]);
  });

  it('keeps the form, the bookmarks and the attachment through an edit', async () => {
    const { compareStructureBytes } = await import('@/lib/verify/structural');
    const edits: Edit[] = [
      { kind: 'rotate', page: page(0), turns: 1 },
      { kind: 'draw', mark: textMark('m', 1, 'anotado') },
    ];
    const { bytes } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, edits, 2),
    });
    expect(await compareStructureBytes(fixture, bytes)).toEqual([]);
  });

  it('drops the page labels once the sequence changes', async () => {
    // They bind to page indices, so after a reorder they would point at the
    // wrong pages. Handing back none beats handing back wrong ones.
    const before = await PDFDocument.load(fixture);
    expect(before.catalog.get(PDFName.of('PageLabels'))).toBeDefined();

    const { bytes } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, [{ kind: 'move', page: page(0), before: null }], 1),
    });
    const after = await PDFDocument.load(bytes);
    expect(after.catalog.get(PDFName.of('PageLabels'))).toBeUndefined();
  });

  it('empties a deleted page even when a bookmark still points at it', async () => {
    // A dangling reference — an outline destination naming the deleted page —
    // keeps the page dictionary reachable, so the garbage collector alone
    // cannot take it. What removes the content is emptying the page before it
    // is unlinked. The image below lives only on that page, so its survival is
    // unambiguous.
    const { PDFStream, PDFString } = await import('pdf-lib');

    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    const doomed = doc.addPage([310, 310]);
    const image = await doc.embedPng(PNG);
    doomed.drawImage(image, { x: 0, y: 0, width: 20, height: 20 });

    const context = doc.context;
    const dest = context.obj([doomed.ref, PDFName.of('XYZ'), null, null, null]);
    const item = context.obj({ Title: PDFString.of('Colgante'), Dest: dest });
    const itemRef = context.register(item);
    const outlines = context.obj({
      Type: PDFName.of('Outlines'),
      First: itemRef,
      Last: itemRef,
      Count: 1,
    });
    const outlinesRef = context.register(outlines);
    item.set(PDFName.of('Parent'), outlinesRef);
    doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
    const original = (await doc.save()).slice();

    const countImages = (loaded: PDFDocument) =>
      loaded.context
        .enumerateIndirectObjects()
        .filter(
          ([, object]) =>
            object instanceof PDFStream &&
            object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
        ).length;

    expect(countImages(await PDFDocument.load(original))).toBeGreaterThan(0);

    const { bytes } = await materialize({
      original,
      assets: noAssets,
      state: stateAt(2, [{ kind: 'delete', page: 'o1' }], 1),
    });
    const out = await PDFDocument.load(bytes);

    expect(out.getPageCount()).toBe(1);
    expect(countImages(out)).toBe(0);
  });

  it('inserts pages from an imported document at the chosen place', async () => {
    const { bytes } = await materialize({
      original: fixture,
      assets: assetsFor(),
      state: stateAt(
        PAGES,
        [{ kind: 'insert', before: page(2), asset: 'deck', indices: [0, 1] }],
        1
      ),
    });
    const out = await PDFDocument.load(bytes);

    expect(out.getPageCount()).toBe(PAGES + 2);
    expect(out.getPages().map((entry) => Math.round(entry.getWidth()))).toEqual([
      pageWidth(0),
      pageWidth(1),
      333,
      555,
      pageWidth(2),
      pageWidth(3),
      pageWidth(4),
    ]);
  });

  it('crops a page and lets the crop be taken back', async () => {
    const { bytes: cropped } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(
        PAGES,
        [{ kind: 'crop', page: page(1), box: { x: 10, y: 20, width: 200, height: 300 } }],
        1
      ),
    });
    const box = (await PDFDocument.load(cropped)).getPage(1).getCropBox();
    expect([box.x, box.y, box.width, box.height]).toEqual([10, 20, 200, 300]);

    const { bytes: uncropped } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(
        PAGES,
        [
          { kind: 'crop', page: page(1), box: { x: 10, y: 20, width: 200, height: 300 } },
          { kind: 'crop', page: page(1), box: null },
        ],
        2
      ),
    });
    expect(Array.from(uncropped)).toEqual(Array.from(fixture));
  });
});

describe('defects found by review, kept fixed', () => {
  it('places an imported page correctly even when an earlier one could not be brought in', async () => {
    const assets = new Map([['deck', imported]]);
    const edits: Edit[] = [
      { kind: 'insert', before: page(0), asset: 'ausente', indices: [0] },
      { kind: 'insert', before: page(1), asset: 'deck', indices: [0] },
    ];
    const { bytes } = await materialize({ original: fixture, assets, state: stateAt(PAGES, edits, 2) });
    const out = await PDFDocument.load(bytes);

    expect(out.getPageCount()).toBe(PAGES + 1);
    expect(out.getPages().map((entry) => Math.round(entry.getWidth()))).toEqual([
      pageWidth(0),
      333,
      pageWidth(1),
      pageWidth(2),
      pageWidth(3),
      pageWidth(4),
    ]);
  });

  it('skips an imported page whose index is past the end of its source', async () => {
    // A session restored after its asset was replaced by a shorter file. Without
    // the guard this throws out of copyPages and every rebuild fails.
    const assets = new Map([['deck', imported]]);
    const { bytes } = await materialize({
      original: fixture,
      assets,
      state: stateAt(PAGES, [{ kind: 'insert', before: page(1), asset: 'deck', indices: [7] }], 1),
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(PAGES);
  });

  it('names the character it cannot draw instead of failing opaquely', async () => {
    const { UnsupportedCharacterError } = await import('@/lib/stamp');
    await expect(
      materialize({
        original: fixture,
        assets: noAssets,
        state: stateAt(PAGES, [{ kind: 'draw', mark: textMark('bad', 0, 'nota 第') }], 1),
      })
    ).rejects.toBeInstanceOf(UnsupportedCharacterError);
  });

  it('still draws everything Spanish needs', async () => {
    const { bytes } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(
        PAGES,
        [{ kind: 'draw', mark: textMark('ok', 0, 'Año — ¿qué tal? ñüáé') }],
        1
      ),
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(PAGES);
  });
});

describe('ORIGINAL', () => {
  it('names the opened document', () => {
    expect(initialState(3).pages.every((entry) => entry.origin.asset === ORIGINAL)).toBe(true);
  });
});
