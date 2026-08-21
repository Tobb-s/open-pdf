import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';

/**
 * Builds the document the structural tests revolve around: pages a test can tell
 * apart by width, plus everything `copyPages` was measured to destroy — a form
 * field with a value, a bookmark, an attachment, a language tag and a title.
 */
export async function buildRichPdf(pageCount = 5): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let index = 0; index < pageCount; index += 1) {
    const page = doc.addPage([pageWidth(index), 500]);
    page.drawText(`P${index}`, { x: 40, y: 400, size: 24, font });
  }

  const form = doc.getForm();
  const field = form.createTextField('alumno.nombre');
  field.setText('Tobías');
  field.addToPage(doc.getPage(Math.min(1, pageCount - 1)), {
    x: 40,
    y: 300,
    width: 200,
    height: 24,
  });

  const context = doc.context;
  const targetPage = doc.getPage(Math.min(3, pageCount - 1));
  const dest = context.obj([targetPage.ref, PDFName.of('XYZ'), null, null, null]);
  const item = context.obj({ Title: PDFString.of('Capítulo'), Dest: dest });
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

  await doc.attach(new Uint8Array([9, 9, 9]), 'notas.bin');
  doc.setLanguage('es-AR');
  doc.setTitle('Fixture');

  // Page labels: roman numerals for the first two pages, decimal from the third.
  // Bound to page indices, which is what makes them fragile under reordering.
  doc.catalog.set(
    PDFName.of('PageLabels'),
    context.obj({
      Nums: [0, { S: PDFName.of('r') }, 2, { S: PDFName.of('D') }],
    })
  );

  return (await doc.save()).slice();
}

/** Page `index` is `400 + index * 10` points wide, so order is observable. */
export function pageWidth(index: number): number {
  return 400 + index * 10;
}
