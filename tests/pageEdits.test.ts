import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { applyPageEdits } from '@/lib/pageEdits';
import { buildRichPdf, pageWidth } from './helpers/richPdf';

let fixture: Uint8Array;

beforeAll(async () => {
  fixture = await buildRichPdf(5);
});

async function inspect(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return {
    widths: doc.getPages().map((page) => page.getWidth()),
    rotations: doc.getPages().map((page) => page.getRotation().angle),
    catalogKeys: ['AcroForm', 'Outlines', 'Names', 'Lang'].filter(
      (key) => doc.catalog.get(PDFName.of(key)) !== undefined
    ),
    fieldNames: doc.getForm().getFields().map((field) => field.getName()),
    title: doc.getTitle(),
  };
}

describe('applyPageEdits', () => {
  it('reorders, rotates and deletes in one pass', async () => {
    const out = await applyPageEdits(fixture, [
      { sourceIndex: 4, rotation: 0 },
      { sourceIndex: 3, rotation: 0 },
      { sourceIndex: 1, rotation: 0 },
      { sourceIndex: 0, rotation: 90 },
    ]);
    const result = await inspect(out);

    expect(result.widths).toEqual([4, 3, 1, 0].map(pageWidth));
    expect(result.rotations).toEqual([0, 0, 0, 90]);
  });

  it('is the stage gate: form, bookmarks and attachment survive the edit', async () => {
    // This is the exact scenario the old copyPages rebuild destroyed, measured:
    // it kept 0 of these 4 structures and emptied the form.
    //
    // The kept pages deliberately include page 1, the one the field is drawn
    // on. They did not before, and the test still expected the field name in
    // the output — which is to say it was asserting a leak: a field whose only
    // widget had been deleted, surviving in the form with its value. Keeping
    // the page is what makes this a test of survival rather than of that.
    const out = await applyPageEdits(fixture, [
      { sourceIndex: 2, rotation: 0 },
      { sourceIndex: 1, rotation: 90 },
      { sourceIndex: 4, rotation: 0 },
    ]);
    const result = await inspect(out);

    expect(result.catalogKeys).toEqual(['AcroForm', 'Outlines', 'Names', 'Lang']);
    expect(result.fieldNames).toEqual(['alumno.nombre']);
    expect(result.title).toBe('Fixture');
  });

  it('takes a field out with the page it was drawn on, value and all', async () => {
    // The other direction, and the one that was wrong. Emptying a page's
    // `/Annots` removes the drawing of a field, not the field: the value hangs
    // off the document's form, which the collector reaches from the trailer, so
    // it survived whole. The exported file still answered with the value —
    // while `countLiveFields` counted zero live widgets and the result card
    // told the reader the form had been LOST. A claim that is the exact
    // opposite of the bytes is worse than no claim.
    const out = await applyPageEdits(fixture, [
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 2, rotation: 0 },
    ]);

    const document = await PDFDocument.load(out);
    expect(document.getForm().getFields().map((field) => field.getName())).toEqual([]);

    // Read back, not merely absent from the field list: pdf-lib writes a value
    // as a hex UTF-16BE string inside a DICTIONARY, so a search of the raw
    // bytes and of the decompressed streams finds nothing and proves nothing.
    let all = Buffer.from(out).toString('latin1');
    for (const [, object] of document.context.enumerateIndirectObjects()) {
      all += object.toString();
    }
    let hex = 'FEFF';
    for (const character of 'Tobías') hex += character.charCodeAt(0).toString(16).padStart(4, '0');
    expect(all.toUpperCase()).not.toContain(hex.toUpperCase());
  });

  it('reverses a document completely', async () => {
    const out = await applyPageEdits(
      fixture,
      [4, 3, 2, 1, 0].map((sourceIndex) => ({ sourceIndex, rotation: 0 }))
    );
    expect((await inspect(out)).widths).toEqual([4, 3, 2, 1, 0].map(pageWidth));
  });

  it('leaves an identity edit truly untouched', async () => {
    const out = await applyPageEdits(
      fixture,
      [0, 1, 2, 3, 4].map((sourceIndex) => ({ sourceIndex, rotation: 0 }))
    );
    const result = await inspect(out);
    expect(result.widths).toEqual([0, 1, 2, 3, 4].map(pageWidth));
    expect(result.rotations).toEqual([0, 0, 0, 0, 0]);
    expect(result.fieldNames).toEqual(['alumno.nombre']);
  });

  it('keeps a single middle page, rotated', async () => {
    const out = await applyPageEdits(fixture, [{ sourceIndex: 2, rotation: 180 }]);
    const result = await inspect(out);
    expect(result.widths).toEqual([pageWidth(2)]);
    expect(result.rotations).toEqual([180]);
    // Catalog still intact even when most pages are gone.
    expect(result.catalogKeys).toContain('AcroForm');
  });

  it('accumulates rotation on top of an existing /Rotate', async () => {
    const once = await applyPageEdits(fixture, [
      { sourceIndex: 0, rotation: 90 },
      { sourceIndex: 1, rotation: 0 },
      { sourceIndex: 2, rotation: 0 },
      { sourceIndex: 3, rotation: 0 },
      { sourceIndex: 4, rotation: 0 },
    ]);
    const twice = await applyPageEdits(once, [
      { sourceIndex: 0, rotation: 270 },
      { sourceIndex: 1, rotation: 0 },
      { sourceIndex: 2, rotation: 0 },
      { sourceIndex: 3, rotation: 0 },
      { sourceIndex: 4, rotation: 0 },
    ]);
    expect((await inspect(twice)).rotations[0]).toBe(0);
  });

  it('refuses an empty edit list', async () => {
    await expect(applyPageEdits(fixture, [])).rejects.toThrow(/at least one/i);
  });

  it('refuses a duplicated page', async () => {
    await expect(
      applyPageEdits(fixture, [
        { sourceIndex: 1, rotation: 0 },
        { sourceIndex: 1, rotation: 0 },
      ])
    ).rejects.toThrow(/twice/i);
  });

  it('refuses an out-of-range page and a bad rotation', async () => {
    await expect(applyPageEdits(fixture, [{ sourceIndex: 9, rotation: 0 }])).rejects.toThrow(
      /out of range/i
    );
    await expect(applyPageEdits(fixture, [{ sourceIndex: 0, rotation: 45 }])).rejects.toThrow(
      /multiple of 90/i
    );
  });
});
