import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFObject,
  PDFRef,
  PDFStream,
} from 'pdf-lib';

export interface GcOptions {
  /**
   * Objects the traversal must NOT enter. Anything reachable only through them
   * is collected too. Used for deleted pages: a bookmark, a form widget's /P or
   * an internal link may still point at a deleted page, and following that
   * pointer would keep the page — and its content — alive in the file. The
   * dangling references left behind are, per the PDF specification, read as
   * `null` by viewers.
   */
  stopAt?: Iterable<PDFRef>;
}

/**
 * Drops every indirect object that nothing reachable from the trailer refers to.
 *
 * pdf-lib has no garbage collector: `removePage` unlinks a page from the page
 * tree, but the page dictionary, its content stream, its images and its fonts
 * stay registered in the context and the writer serialises all of them.
 * Measured: deleting one of three pages left the output with the same ten
 * objects and the same byte count as the input. A reader who deletes a page
 * holding sensitive content and shares the file would be sharing that content.
 *
 * Reachability is computed generically — every value of every dictionary and
 * array, starting from the trailer's Root and Info — so anything a surviving
 * page still uses (a font shared with a deleted page, say) is marked and kept.
 * Only objects no live structure points at are removed.
 */
export function removeUnreachableObjects(doc: PDFDocument, options: GcOptions = {}): number {
  const context = doc.context;
  const reachable = new Set<string>();
  const barriers = new Set<string>();
  for (const ref of options.stopAt ?? []) barriers.add(ref.tag);

  const mark = (value: PDFObject | undefined): void => {
    if (!value) return;

    if (value instanceof PDFRef) {
      if (barriers.has(value.tag) || reachable.has(value.tag)) return;
      reachable.add(value.tag);
      mark(context.lookup(value));
      return;
    }
    if (value instanceof PDFStream) {
      mark(value.dict);
      return;
    }
    if (value instanceof PDFDict) {
      for (const [, entry] of value.entries()) mark(entry);
      return;
    }
    if (value instanceof PDFArray) {
      for (let index = 0; index < value.size(); index += 1) mark(value.get(index));
    }
  };

  const trailer = context.trailerInfo;
  mark(trailer.Root);
  mark(trailer.Info);
  mark(trailer.Encrypt);
  mark(trailer.ID);

  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.tag)) {
      context.delete(ref);
      removed += 1;
    }
  }
  return removed;
}
