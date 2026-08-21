import { PDFName, degrees } from 'pdf-lib';
import { removeUnreachableObjects } from '@/lib/pdfGc';
import { loadPdf, savePdf } from '@/lib/pdfio';

export interface PageEdit {
  /** 0-based index of the page in the original document. */
  sourceIndex: number;
  /** Extra clockwise rotation the reader applied: 0, 90, 180 or 270. */
  rotation: number;
}

/**
 * Applies reordering, rotation and deletion to a document IN PLACE.
 *
 * The output document IS the input document, mutated — never a fresh
 * `PDFDocument.create()` filled with `copyPages`. The difference is everything
 * that lives outside the page tree: rebuilding from copies was measured to strip
 * the form fields, bookmarks, attachments, language and metadata from every
 * document it touched, because `copyPages` copies pages and not the catalog.
 * Mutating in place keeps all of it.
 *
 * A pdf-lib pitfall shapes the implementation: `removePage` does not invalidate
 * the internal page cache (while `insertPage` does), so `getPages()` returns a
 * STALE list after any deletion. The tree is therefore queried exactly once, up
 * front, and the current order is mirrored in a plain array from then on.
 */
export async function applyPageEdits(
  bytes: Uint8Array,
  edits: readonly PageEdit[]
): Promise<Uint8Array> {
  if (edits.length === 0) {
    throw new Error('At least one page must remain in the document.');
  }

  const seen = new Set<number>();
  for (const edit of edits) {
    if (!Number.isInteger(edit.sourceIndex) || edit.sourceIndex < 0) {
      throw new Error(`Invalid page index: ${edit.sourceIndex}`);
    }
    if (seen.has(edit.sourceIndex)) {
      throw new Error(`Page ${edit.sourceIndex} appears twice in the edit list.`);
    }
    seen.add(edit.sourceIndex);
    if (edit.rotation % 90 !== 0) {
      throw new Error(`Rotation must be a multiple of 90, got ${edit.rotation}.`);
    }
  }

  // The reader's edits should not silently refresh the file's modification date.
  const doc = await loadPdf(bytes, { updateMetadata: false });

  // The one and only page-tree query. Stable handles, keyed by original index.
  const original = doc.getPages();

  for (const edit of edits) {
    if (edit.sourceIndex >= original.length) {
      throw new Error(
        `Page index ${edit.sourceIndex} is out of range for a ${original.length}-page document.`
      );
    }
  }

  // Rotations first: they act on the page objects, not the tree, so original
  // indices are still meaningful.
  for (const edit of edits) {
    if (edit.rotation % 360 !== 0) {
      const page = original[edit.sourceIndex];
      const angle = (((page.getRotation().angle + edit.rotation) % 360) + 360) % 360;
      page.setRotation(degrees(angle));
    }
  }

  // Our own mirror of the tree order, by original index. Every removePage /
  // insertPage below uses positions computed from this mirror, never from
  // pdf-lib's (stale) view.
  const order = original.map((_, index) => index);
  const finalOrder = edits.map((edit) => edit.sourceIndex);
  const keep = new Set(finalOrder);

  for (let index = original.length - 1; index >= 0; index -= 1) {
    if (!keep.has(index)) {
      // Strip the page's content BEFORE unlinking it. A dangling reference —
      // a bookmark whose destination is this page, say — keeps the page dict
      // reachable, and through it everything the page carried would survive
      // the garbage collector below. Emptying the dict first means that even
      // a husk that stays reachable carries nothing.
      const node = original[index].node;
      node.delete(PDFName.of('Contents'));
      node.delete(PDFName.of('Resources'));
      node.delete(PDFName.of('Annots'));
      node.delete(PDFName.of('Thumb'));

      const at = order.indexOf(index);
      doc.removePage(at);
      order.splice(at, 1);
    }
  }

  // Selection sort: cheap for the page counts a person reorders by hand, and
  // every step is a plain remove-then-insert of an existing page handle.
  for (let target = 0; target < finalOrder.length; target += 1) {
    const want = finalOrder[target];
    const from = order.indexOf(want);
    if (from !== target) {
      doc.removePage(from);
      doc.insertPage(target, original[want]);
      order.splice(from, 1);
      order.splice(target, 0, want);
    }
  }

  // /PageLabels binds labels ("i, ii, iii, 1, 2…") to page INDICES. Once pages
  // move or disappear the ranges point at the wrong physical pages, silently.
  // Remapping the number tree is an editor feature for later; until then the
  // honest move is to drop the labels and let the result card say so, rather
  // than hand back labels that are now wrong.
  const sequenceChanged =
    finalOrder.length !== original.length || finalOrder.some((index, at) => index !== at);
  if (sequenceChanged) {
    doc.catalog.delete(PDFName.of('PageLabels'));
  }

  // Unlinking a page from the tree does not remove it from the file: pdf-lib
  // serialises every registered object. Collect what nothing points at any
  // more, so a deleted page is actually gone from the bytes handed back. The
  // deleted pages are barriers: a bookmark or form widget still pointing at one
  // must not keep it alive.
  const deleted = original.filter((_, index) => !keep.has(index)).map((page) => page.ref);
  removeUnreachableObjects(doc, { stopAt: deleted });

  return savePdf(doc);
}
