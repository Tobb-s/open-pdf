import { PDFDocument, PDFName, PDFPage, PDFRef } from 'pdf-lib';

/**
 * Taking a form field out with the page it was drawn on.
 *
 * A widget is only where a field is DRAWN. The value lives in the field, which
 * hangs off the document's AcroForm and off the catalogue — so emptying a
 * page's `/Annots` removes the drawing and leaves the data. Since the collector
 * marks from the trailer, the field is reachable and survives whole: the
 * exported file still answers `getTextField(name).getText()` with the value the
 * reader believed they had removed.
 *
 * Worse than the leak is what the app then says about it. `countLiveFields`
 * counts by live widget, so the count drops to zero and the result card reports
 * that the form was LOST — telling the reader they gave something up while the
 * file they are about to share still carries it. That is the one direction of
 * error this project cannot afford: not an unproven claim, but a claim that is
 * the exact opposite of the bytes.
 *
 * This lives on its own because three paths need it and each learned it
 * separately: rasterising a page for redaction, deleting a page in Studio, and
 * deleting a page with the Organize tool.
 */

/**
 * The annotation references on a page, before the page loses them.
 *
 * Call this while `/Annots` is still there. A direct dictionary rather than a
 * reference is ignored: it cannot be shared with the form, so it leaves with
 * the page anyway.
 */
export function annotationRefs(page: PDFPage): string[] {
  const annots = page.node.Annots();
  if (!annots) return [];

  const tags: string[] = [];
  for (let index = 0; index < annots.size(); index += 1) {
    const entry = annots.get(index);
    if (entry instanceof PDFRef) tags.push(entry.tag);
  }
  return tags;
}

/**
 * Drops every field whose widgets have all gone, and prunes the ones that lost
 * only some.
 *
 * A field drawn on two pages, one of which survives, keeps its value: it is
 * still visible somewhere, so removing it would destroy something the reader
 * can see. Only a field with nothing left to draw it is removed — which is the
 * case where the value would otherwise be present and invisible.
 *
 * Returns how many fields were removed, so a caller can tell whether it needs
 * to say anything.
 */
export function dropFieldsWithoutWidgets(document: PDFDocument, gone: Set<string>): number {
  if (gone.size === 0) return 0;
  // Asking for a form the document does not have would CREATE one, adding an
  // empty AcroForm to a file that never had a field in it.
  if (document.catalog.get(PDFName.of('AcroForm')) === undefined) return 0;

  let removed = 0;
  try {
    const form = document.getForm();

    for (const field of form.getFields()) {
      const kids = field.acroField.Kids();

      if (!kids) {
        // A merged field: the field dictionary is its own widget.
        if (gone.has(field.acroField.ref.tag)) {
          form.removeField(field);
          removed += 1;
        }
        continue;
      }

      for (let index = kids.size() - 1; index >= 0; index -= 1) {
        const entry = kids.get(index);
        if (entry instanceof PDFRef && gone.has(entry.tag)) kids.remove(index);
      }

      if (kids.size() === 0) {
        form.removeField(field);
        removed += 1;
      }
    }
  } catch {
    // A form too damaged to walk is not a reason to lose the document. The
    // caller's own verification is what decides whether the result is
    // acceptable to hand over.
  }

  return removed;
}
