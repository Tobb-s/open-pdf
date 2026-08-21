import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFStream, PDFString, StandardFonts } from 'pdf-lib';
import { applyPageEdits } from '@/lib/pageEdits';
import { removeUnreachableObjects } from '@/lib/pdfGc';

async function threePageDoc(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // One font shared by every page: the GC must keep it while dropping the
  // deleted page's own objects.
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 3; index += 1) {
    const page = doc.addPage([400 + index * 10, 500]);
    page.drawText(`SECRETO-${index}`, { x: 40, y: 400, size: 24, font });
  }
  return (await doc.save()).slice();
}

describe('removeUnreachableObjects', () => {
  it('actually removes a deleted page from the bytes', async () => {
    // The review finding: removePage only unlinks from the page tree; pdf-lib
    // serialises every registered object, so the "deleted" page shipped intact.
    // Measured before the GC: same object count, same byte size.
    const original = await threePageDoc();
    const sourceObjects = (await PDFDocument.load(original)).context.enumerateIndirectObjects()
      .length;

    const out = await applyPageEdits(original, [
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 2, rotation: 0 },
    ]);
    const outDoc = await PDFDocument.load(out);

    expect(outDoc.getPageCount()).toBe(2);
    // The deleted page dict and its content stream are gone, not just unlinked.
    expect(outDoc.context.enumerateIndirectObjects().length).toBeLessThan(sourceObjects);
  });

  it('keeps a resource shared with a surviving page', async () => {
    const original = await threePageDoc();
    const out = await applyPageEdits(original, [
      { sourceIndex: 1, rotation: 0 },
    ]);

    // The surviving page still extracts its text — the shared font was reachable
    // through it and must not have been collected.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(out) });
    const doc = await task.promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join('');
    await task.destroy();

    expect(text).toContain('SECRETO-1');
    expect(text).not.toContain('SECRETO-0');
  });

  it('removes nothing from a document with no garbage', async () => {
    const original = await threePageDoc();
    const doc = await PDFDocument.load(original);
    expect(removeUnreachableObjects(doc)).toBe(0);
  });

  it('empties a deleted page even when a dangling bookmark keeps it reachable', async () => {
    // The corner the plain GC misses: an outline /Dest holds a reference to the
    // deleted page, so the page dict itself cannot be collected. The editor
    // strips the page's Contents/Resources first, so what survives is a husk.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    const keepPage = doc.addPage([400, 500]);
    keepPage.drawText('VISIBLE', { x: 40, y: 400, size: 24, font });
    const deadPage = doc.addPage([410, 500]);
    // A unique image, so its survival is unambiguous: nothing else embeds one.
    const png = await doc.embedPng(
      // 1x1 transparent PNG
      Uint8Array.from(
        atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
        (c) => c.charCodeAt(0)
      )
    );
    deadPage.drawImage(png, { x: 0, y: 0, width: 10, height: 10 });

    // Bookmark pointing at the page we are about to delete.
    const context = doc.context;
    const dest = context.obj([deadPage.ref, PDFName.of('XYZ'), null, null, null]);
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
    const out = await applyPageEdits(original, [{ sourceIndex: 0, rotation: 0 }]);

    // The image XObject lived only on the deleted page; it must be gone even
    // though the page dict itself is still referenced by the dangling Dest.
    const outDoc = await PDFDocument.load(out);
    // PDFName.of interns its instances, so identity comparison is the right test.
    const imageStreams = outDoc.context
      .enumerateIndirectObjects()
      .filter(
        ([, object]) =>
          object instanceof PDFStream &&
          object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
      );
    expect(imageStreams).toHaveLength(0);
    expect(outDoc.getPageCount()).toBe(1);
  });
});
