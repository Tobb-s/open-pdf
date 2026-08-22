import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createStudioEngine } from '@/lib/studio/engine';
import { stateAt, type Edit } from '@/lib/studio/script';
import { buildRichPdf, pageWidth } from './helpers/richPdf';

/**
 * The fallback path.
 *
 * `createStudioEngine` tries to build a Worker and drops to the main thread if
 * it cannot. Node has no `Worker` constructor of the browser kind, so running
 * these here exercises exactly the branch a reader gets when their browser
 * refuses one — the branch that would otherwise ship untested because it only
 * appears when something has already gone wrong.
 */

let fixture: Uint8Array;
const PAGES = 5;

beforeAll(async () => {
  fixture = await buildRichPdf(PAGES);
});

describe('the main-thread fallback', () => {
  it('is what you get when a worker cannot be built', () => {
    const engine = createStudioEngine();
    expect(engine.offMainThread).toBe(false);
    engine.dispose();
  });

  it('renders the same document the worker would', async () => {
    const engine = createStudioEngine();
    await engine.open(fixture);

    const edits: Edit[] = [
      { kind: 'rotate', page: 'o0', turns: 1 },
      { kind: 'delete', page: 'o2' },
      { kind: 'move', page: 'o4', before: 'o0' },
    ];
    const { bytes, millis, offMainThread } = await engine.render(stateAt(PAGES, edits, 3));

    expect(offMainThread).toBe(false);
    expect(millis).toBeGreaterThanOrEqual(0);

    const out = await PDFDocument.load(bytes);
    expect(out.getPages().map((page) => page.getWidth())).toEqual([4, 0, 1, 3].map(pageWidth));
    expect(out.getPages().map((page) => page.getRotation().angle)).toEqual([0, 90, 0, 0]);

    engine.dispose();
  });

  it('gives the original back byte for byte when everything is undone', async () => {
    const engine = createStudioEngine();
    await engine.open(fixture);

    const edits: Edit[] = [
      { kind: 'rotate', page: 'o0', turns: 3 },
      { kind: 'delete', page: 'o1' },
    ];
    await engine.render(stateAt(PAGES, edits, 2));
    const { bytes } = await engine.render(stateAt(PAGES, edits, 0));

    expect(Array.from(bytes)).toEqual(Array.from(fixture));
    engine.dispose();
  });

  it('refuses to render before a document is open', async () => {
    const engine = createStudioEngine();
    await expect(engine.render(stateAt(0, [], 0))).rejects.toThrow(/no document/i);
    engine.dispose();
  });

  it('carries imported assets into the render', async () => {
    const imported = await PDFDocument.create();
    imported.addPage([321, 654]);
    const importedBytes = (await imported.save()).slice();

    const engine = createStudioEngine();
    await engine.open(fixture);
    engine.putAsset('extra', importedBytes);

    const edits: Edit[] = [{ kind: 'insert', before: 'o1', asset: 'extra', indices: [0] }];
    const { bytes } = await engine.render(stateAt(PAGES, edits, 1));

    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(PAGES + 1);
    expect(Math.round(out.getPage(1).getWidth())).toBe(321);

    engine.dispose();
  });

  it('exports with a report read from the produced bytes', async () => {
    const engine = createStudioEngine();
    await engine.open(fixture);

    const edits: Edit[] = [{ kind: 'delete', page: 'o1' }];
    const result = await engine.exportDocument(stateAt(PAGES, edits, 1));

    // The count comes from the file, not from the script's intent.
    expect(result.pages).toBe(PAGES - 1);
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(result.pages);

    // Page 1 carried the form's only widget, so the form is honestly reported
    // as lost rather than announced as preserved.
    expect(result.before.categories.form).toBe(1);
    expect(result.after.categories.form).toBe(0);

    engine.dispose();
  });

  it('forgets the previous document when a new one is opened', async () => {
    const engine = createStudioEngine();
    await engine.open(fixture);
    engine.putAsset('extra', new Uint8Array([1, 2, 3]));

    const other = await PDFDocument.create();
    other.addPage([200, 200]);
    const otherBytes = (await other.save()).slice();
    await engine.open(otherBytes);

    // The asset belonged to the previous session and must not leak into this one.
    const { bytes } = await engine.render(
      stateAt(1, [{ kind: 'insert', before: null, asset: 'extra', indices: [0] }], 1)
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);

    engine.dispose();
  });
});
