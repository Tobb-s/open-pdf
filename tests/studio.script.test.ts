import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { materialize } from '@/lib/studio/materialize';
import {
  append,
  initialState,
  isUntouched,
  ORIGINAL,
  stateAt,
  type Edit,
  type Mark,
} from '@/lib/studio/script';
import { buildRichPdf, pageWidth } from './helpers/richPdf';

let fixture: Uint8Array;
const PAGES = 5;
const noAssets = new Map<string, Uint8Array>();

beforeAll(async () => {
  fixture = await buildRichPdf(PAGES);
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

/** Twenty edits of every kind the script supports, on a real document. */
function twentyEdits(): Edit[] {
  return [
    { kind: 'rotate', page: page(0), turns: 1 },
    { kind: 'rotate', page: page(1), turns: 2 },
    { kind: 'move', page: page(4), toIndex: 0 },
    { kind: 'draw', mark: textMark('m1', 2, 'uno') },
    { kind: 'crop', page: page(3), box: { x: 20, y: 20, width: 300, height: 400 } },
    { kind: 'delete', page: page(2) },
    { kind: 'rotate', page: page(3), turns: 3 },
    { kind: 'draw', mark: textMark('m2', 0, 'dos') },
    { kind: 'move', page: page(0), toIndex: 3 },
    {
      kind: 'draw',
      mark: {
        kind: 'rect',
        id: 'm3',
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
    { kind: 'erase', markId: 'm1' },
    { kind: 'crop', page: page(0), box: { x: 0, y: 0, width: 200, height: 200 } },
    {
      kind: 'draw',
      mark: {
        kind: 'ink',
        id: 'm4',
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
    { kind: 'move', page: page(3), toIndex: 0 },
    { kind: 'crop', page: page(3), box: null },
    { kind: 'rotate', page: page(0), turns: 3 },
    { kind: 'draw', mark: textMark('m5', 4, 'cinco') },
    { kind: 'delete', page: page(1) },
    { kind: 'move', page: page(4), toIndex: 1 },
  ];
}

describe('the edit script', () => {
  it('has twenty edits in the fixture, so the gate really is twenty', () => {
    expect(twentyEdits()).toHaveLength(20);
  });

  it('undo and redo are just a cursor', () => {
    const edits = twentyEdits();
    const atFive = stateAt(PAGES, edits, 5);
    const there = stateAt(PAGES, edits, 20);
    const backAgain = stateAt(PAGES, edits, 5);

    expect(backAgain).toEqual(atFive);
    expect(there).not.toEqual(atFive);
  });

  it('arriving at a cursor by any route gives the same state', () => {
    // The property undo depends on: state is a function of (edits, cursor) and
    // of nothing else. If replaying ever accumulated hidden state, this breaks.
    const edits = twentyEdits();
    for (let cursor = 0; cursor <= edits.length; cursor += 1) {
      expect(stateAt(PAGES, edits, cursor), `cursor ${cursor}`).toEqual(
        stateAt(PAGES, edits, cursor)
      );
    }
    expect(stateAt(PAGES, edits, 0)).toEqual(initialState(PAGES));
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

  it('deleting a page takes its marks with it, so undo brings both back', () => {
    const edits: Edit[] = [
      { kind: 'draw', mark: textMark('m', 2, 'nota') },
      { kind: 'delete', page: page(2) },
    ];
    expect(stateAt(PAGES, edits, 1).marks).toHaveLength(1);
    expect(stateAt(PAGES, edits, 2).marks).toHaveLength(0);
    // Undo the delete: the mark is back, because the state was replayed.
    expect(stateAt(PAGES, edits, 1).marks).toHaveLength(1);
  });

  it('refuses to delete the last page', () => {
    const edits: Edit[] = Array.from({ length: PAGES }, (_, index) => ({
      kind: 'delete' as const,
      page: page(index),
    }));
    expect(stateAt(PAGES, edits, PAGES).pages).toHaveLength(1);
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

    // Make all twenty count: the document really is different at the end.
    const edited = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, edits, 20),
    });
    expect(Array.from(edited)).not.toEqual(Array.from(fixture));

    // Now undo all twenty and export again.
    const undone = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, edits, 0),
    });

    expect(undone.byteLength).toBe(fixture.byteLength);
    expect(Array.from(undone)).toEqual(Array.from(fixture));
  });

  it('materialising twice from the same cursor gives the same bytes', async () => {
    // Byte-for-byte determinism at an arbitrary cursor, not just at zero: this
    // is what says the twenty-undo result was not a lucky special case.
    const edits = twentyEdits();
    for (const cursor of [3, 11, 20]) {
      const once = await materialize({
        original: fixture,
        assets: noAssets,
        state: stateAt(PAGES, edits, cursor),
      });
      const twice = await materialize({
        original: fixture,
        assets: noAssets,
        state: stateAt(PAGES, edits, cursor),
      });
      expect(Array.from(twice), `cursor ${cursor}`).toEqual(Array.from(once));
    }
  });

  it('going forward, back and forward again lands on the same bytes', async () => {
    const edits = twentyEdits();
    const direct = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, edits, 7),
    });
    // Simulate the reader wandering: to the end, back to the start, then to 7.
    stateAt(PAGES, edits, 20);
    stateAt(PAGES, edits, 0);
    const wandered = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, edits, 7),
    });
    expect(Array.from(wandered)).toEqual(Array.from(direct));
  });

  it('applies order, rotation and deletion the way the script says', async () => {
    const edits: Edit[] = [
      { kind: 'move', page: page(4), toIndex: 0 },
      { kind: 'rotate', page: page(0), turns: 1 },
      { kind: 'delete', page: page(2) },
    ];
    const bytes = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, edits, 3),
    });
    const out = await PDFDocument.load(bytes);

    expect(out.getPages().map((p) => p.getWidth())).toEqual(
      [4, 0, 1, 3].map(pageWidth)
    );
    expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 0, 0]);
  });

  it('keeps the form, the bookmarks and the attachment through an edit', async () => {
    const { compareStructureBytes } = await import('@/lib/verify/structural');
    const edits: Edit[] = [
      { kind: 'rotate', page: page(0), turns: 1 },
      { kind: 'draw', mark: textMark('m', 1, 'anotado') },
    ];
    const bytes = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, edits, 2),
    });
    // Rotation and a mark change no page's identity, so nothing may be lost.
    expect(await compareStructureBytes(fixture, bytes)).toEqual([]);
  });

  it('really removes a deleted page rather than unlinking it', async () => {
    const before = (await PDFDocument.load(fixture)).context.enumerateIndirectObjects().length;
    const bytes = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, [{ kind: 'delete', page: page(2) }], 1),
    });
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(PAGES - 1);
    expect(out.context.enumerateIndirectObjects().length).toBeLessThan(before);
  });

  it('inserts pages from an imported document at the chosen place', async () => {
    const imported = await PDFDocument.create();
    imported.addPage([333, 444]);
    imported.addPage([555, 666]);
    const assets = new Map([['import1', (await imported.save()).slice()]]);

    const edits: Edit[] = [
      { kind: 'insert', at: 2, asset: 'import1', indices: [0, 1] },
    ];
    const bytes = await materialize({
      original: fixture,
      assets,
      state: stateAt(PAGES, edits, 1),
    });
    const out = await PDFDocument.load(bytes);

    expect(out.getPageCount()).toBe(PAGES + 2);
    expect(out.getPages().map((p) => Math.round(p.getWidth()))).toEqual([
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
    const cropped = await materialize({
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

    const uncropped = await materialize({
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
    // Back to the page's own box, and byte-identical to the original because
    // the script is once again asking for nothing.
    expect(Array.from(uncropped)).toEqual(Array.from(fixture));
  });

  it('draws every kind of mark without losing any of them', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const edits: Edit[] = [
      { kind: 'draw', mark: textMark('t', 0, 'MARCA-TEXTO') },
      {
        kind: 'draw',
        mark: {
          kind: 'ink',
          id: 'i',
          page: page(0),
          points: [
            [20, 20],
            [60, 80],
          ],
          color: { r: 1, g: 0, b: 0 },
          width: 3,
        },
      },
      {
        kind: 'draw',
        mark: {
          kind: 'rect',
          id: 'r',
          page: page(0),
          x: 100,
          y: 100,
          width: 80,
          height: 40,
          color: { r: 0, g: 1, b: 0 },
          borderColor: null,
          borderWidth: 0,
          opacity: 1,
        },
      },
    ];
    const bytes = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, edits, 3),
    });

    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const doc = await task.promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    await task.destroy();

    expect(text).toContain('MARCA-TEXTO');
    // The ink and the rectangle are not text; their presence shows up as extra
    // operators, which the byte length reflects against a text-only run.
    const textOnly = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, [edits[0]], 1),
    });
    expect(bytes.byteLength).toBeGreaterThan(textOnly.byteLength);
  });

  it('leaves an imported asset that went missing alone instead of failing', async () => {
    const bytes = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, [{ kind: 'insert', at: 0, asset: 'perdido', indices: [0] }], 1),
    });
    // The page could not be brought in, but the rest of the document survives.
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(PAGES);
  });
});

describe('defects found by review, kept fixed', () => {
  it('places an imported page correctly even when an earlier one could not be brought in', async () => {
    // Absolute positions assume every earlier page made it in. One that could
    // not — a missing asset — used to leave a hole, and every later insertion
    // landed one place too far along.
    const imported = await PDFDocument.create();
    imported.addPage([333, 444]);
    const assets = new Map([['present', (await imported.save()).slice()]]);

    const edits: Edit[] = [
      { kind: 'insert', at: 0, asset: 'ausente', indices: [0] },
      { kind: 'insert', at: 2, asset: 'present', indices: [0] },
    ];
    const bytes = await materialize({
      original: fixture,
      assets,
      state: stateAt(PAGES, edits, 2),
    });
    const out = await PDFDocument.load(bytes);

    // The missing page simply is not there; the one that could be brought in
    // sits between the two original pages the reader put it between.
    expect(out.getPageCount()).toBe(PAGES + 1);
    expect(out.getPages().map((page) => Math.round(page.getWidth()))).toEqual([
      pageWidth(0),
      333,
      pageWidth(1),
      pageWidth(2),
      pageWidth(3),
      pageWidth(4),
    ]);
  });

  it('names the character it cannot draw instead of failing opaquely', async () => {
    const { UnsupportedCharacterError } = await import('@/lib/stamp');
    const mark: Mark = textMark('bad', 0, 'nota 第');

    await expect(
      materialize({
        original: fixture,
        assets: noAssets,
        state: stateAt(PAGES, [{ kind: 'draw', mark }], 1),
      })
    ).rejects.toBeInstanceOf(UnsupportedCharacterError);
  });

  it('still draws everything Spanish needs', async () => {
    const mark: Mark = textMark('ok', 0, 'Año — ¿qué tal? ñüáé');
    const bytes = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, [{ kind: 'draw', mark }], 1),
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(PAGES);
  });
});

describe('ORIGINAL', () => {
  it('names the opened document', () => {
    expect(initialState(3).pages.every((page) => page.origin.asset === ORIGINAL)).toBe(true);
  });
});
