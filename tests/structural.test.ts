import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  compareStructureBytes,
  diffStructures,
  reportStructures,
  summarizeStructures,
} from '@/lib/verify/structural';
import { applyPageEdits } from '@/lib/pageEdits';
import { buildRichPdf } from './helpers/richPdf';

let fixture: Uint8Array;

beforeAll(async () => {
  fixture = await buildRichPdf(5);
});

describe('summarizeStructures', () => {
  it('sees everything the fixture carries', async () => {
    const summary = summarizeStructures(await PDFDocument.load(fixture));

    expect(summary.pageCount).toBe(5);
    expect(summary.categories.form).toBe(1);
    expect(summary.categories.bookmarks).toBe(1);
    expect(summary.categories.attachments).toBe(1);
    expect(summary.categories.metadataTitle).toBe(1);
    expect(summary.categories.language).toBe(1);
  });

  it('counts an AcroForm with no fields as no form at all', async () => {
    // Some producers emit /AcroForm << /NeedAppearances true >> with no /Fields.
    // Counting that as a form made merge warn about losing fields that never
    // existed.
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.catalog.set(
      PDFName.of('AcroForm'),
      doc.context.obj({ NeedAppearances: true })
    );
    const bytes = await doc.save();
    const summary = summarizeStructures(await PDFDocument.load(bytes));
    expect(summary.categories.form).toBe(0);
  });

  it('does not invent an AcroForm on a document that has none', async () => {
    // doc.getForm() CREATES an empty AcroForm — a verifier that mutates what it
    // verifies would be worse than none. This guards against that regression.
    const plain = await PDFDocument.create();
    plain.addPage([200, 200]);
    const bytes = await plain.save();

    const doc = await PDFDocument.load(bytes);
    const summary = summarizeStructures(doc);

    expect(summary.categories.form).toBe(0);
    expect(doc.catalog.get(PDFName.of('AcroForm'))).toBeUndefined();
  });
});

describe('reportStructures.present', () => {
  it('never vouches for presence-only categories', async () => {
    // A tagged document: StructTreeRoot present. We cannot verify a tag tree
    // survived page edits intact, so its survival is never claimed — only its
    // total loss would be reported.
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.catalog.set(PDFName.of('StructTreeRoot'), doc.context.obj({}));
    doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: [] }));
    doc.setTitle('Etiquetado');
    const bytes = (await doc.save()).slice();

    const report = await reportStructures(bytes, bytes);
    expect(report.present).toContain('metadataTitle');
    expect(report.present).not.toContain('accessibility');
    expect(report.present).not.toContain('layers');
  });
});

describe('diffStructures', () => {
  it('convicts the copyPages rebuild the shipped tools used to do', async () => {
    // Exactly what organize/merge did before: fresh document + copied pages.
    const source = await PDFDocument.load(fixture);
    const rebuilt = await PDFDocument.create();
    const copied = await rebuilt.copyPages(source, source.getPageIndices());
    for (const page of copied) rebuilt.addPage(page);

    const losses = diffStructures(
      summarizeStructures(source),
      summarizeStructures(rebuilt)
    );
    const lostCategories = losses.map((loss) => loss.category);

    expect(lostCategories).toContain('form');
    expect(lostCategories).toContain('bookmarks');
    expect(lostCategories).toContain('attachments');
    expect(lostCategories).toContain('language');
  });

  it('clears a rotation-only edit completely', async () => {
    // Rotation touches no structure: same order, same pages, nothing to lose.
    const out = await applyPageEdits(
      fixture,
      [0, 1, 2, 3, 4].map((sourceIndex) => ({
        sourceIndex,
        rotation: sourceIndex === 1 ? 90 : 0,
      }))
    );
    expect(await compareStructureBytes(fixture, out)).toEqual([]);
  });

  it('reports the page-label drop when the sequence changes, and nothing else', async () => {
    // Keeps the widget page (1) and the bookmark page (3); deletes page 4.
    // PageLabels bind to indices, so the editor drops them and the report says so.
    const out = await applyPageEdits(fixture, [
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 1, rotation: 0 },
      { sourceIndex: 2, rotation: 0 },
      { sourceIndex: 3, rotation: 0 },
    ]);
    const losses = await compareStructureBytes(fixture, out);
    expect(losses.map((loss) => loss.category)).toEqual(['pageLabels']);
  });

  it('reports the form as lost when its widget page is deleted', async () => {
    // The field object survives in /Fields, but its only widget sat on page 1.
    // Counting catalog entries would call that "survived intact"; counting live
    // widgets calls it what the reader experiences: gone.
    const out = await applyPageEdits(fixture, [
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 2, rotation: 0 },
      { sourceIndex: 3, rotation: 0 },
      { sourceIndex: 4, rotation: 0 },
    ]);
    const categories = (await compareStructureBytes(fixture, out)).map((loss) => loss.category);
    expect(categories).toContain('form');
    expect(categories).not.toContain('bookmarks');
  });

  it('reports the bookmark as lost when its destination page is deleted', async () => {
    // The outline item remains in the tree, but its /Dest points at page 3.
    const out = await applyPageEdits(fixture, [
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 1, rotation: 0 },
      { sourceIndex: 2, rotation: 0 },
      { sourceIndex: 4, rotation: 0 },
    ]);
    const categories = (await compareStructureBytes(fixture, out)).map((loss) => loss.category);
    expect(categories).toContain('bookmarks');
    expect(categories).not.toContain('form');
  });

  it('reports nothing when neither side has structures', async () => {
    const plain = await PDFDocument.create();
    plain.addPage([200, 200]);
    const bytes = (await plain.save()).slice();
    expect(await compareStructureBytes(bytes, bytes)).toEqual([]);
  });
});
