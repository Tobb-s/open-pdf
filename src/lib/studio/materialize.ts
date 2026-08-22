import {
  LineCapStyle,
  PDFDocument,
  PDFName,
  PDFPage,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import { removeUnreachableObjects } from '@/lib/pdfGc';
import { loadPdf, savePdf } from '@/lib/pdfio';
import {
  firstUnsupportedCharacter,
  imageKind,
  standardFontFor,
  UnsupportedCharacterError,
} from '@/lib/stamp';
import {
  isUntouched,
  ORIGINAL,
  type Mark,
  type PageState,
  type Rgb,
  type ScriptState,
} from '@/lib/studio/script';

/**
 * Turns a script state into the bytes the reader would download.
 *
 * This is the only place the document is built, and it is built from the
 * original bytes every time — never from the previous materialisation. That is
 * what stops twenty edits from accumulating twenty generations of re-encoding,
 * and it is why undoing to the start really does give the file back.
 */

export interface MaterializeInput {
  original: Uint8Array;
  /** Imported PDFs and images, by asset id. */
  assets: ReadonlyMap<string, Uint8Array>;
  state: ScriptState;
}

const colorOf = (color: Rgb) => rgb(color.r, color.g, color.b);

/**
 * Applies the page list in place: deletions, order and rotation, exactly as the
 * Organize tool does, and for the same reason — rebuilding with `copyPages`
 * would throw away the form, the bookmarks and the attachments.
 *
 * pdf-lib's `removePage` does not invalidate its page cache while `insertPage`
 * does, so the tree is read once and the order is mirrored here instead.
 */
function arrangeOriginalPages(
  document: PDFDocument,
  surviving: readonly PageState[]
): { pages: Map<string, PDFPage>; deleted: PDFPage[] } {
  const original = document.getPages();
  const wanted = surviving
    .filter((page) => page.origin.asset === ORIGINAL)
    .map((page) => page.origin.index);
  const keep = new Set(wanted);

  const byId = new Map<string, PDFPage>();
  for (const page of surviving) {
    if (page.origin.asset === ORIGINAL) {
      const handle = original[page.origin.index];
      if (handle) byId.set(page.id, handle);
    }
  }

  const order = original.map((_, index) => index);
  const deleted: PDFPage[] = [];

  for (let index = original.length - 1; index >= 0; index -= 1) {
    if (keep.has(index)) continue;
    deleted.push(original[index]);
    const at = order.indexOf(index);
    if (at !== -1) {
      document.removePage(at);
      order.splice(at, 1);
    }
  }

  for (let target = 0; target < wanted.length; target += 1) {
    const want = wanted[target];
    const from = order.indexOf(want);
    if (from !== -1 && from !== target) {
      document.removePage(from);
      document.insertPage(target, original[want]);
      order.splice(from, 1);
      order.splice(target, 0, want);
    }
  }

  return { pages: byId, deleted };
}

/** Copies the imported pages in, at the positions the script asked for. */
async function insertImportedPages(
  document: PDFDocument,
  state: ScriptState,
  assets: ReadonlyMap<string, Uint8Array>,
  byId: Map<string, PDFPage>
): Promise<void> {
  const loaded = new Map<string, PDFDocument>();

  // Walked in order, counting what has actually been placed rather than trusting
  // the position in the script. A page that could not be brought in — its asset
  // is gone, or its index is past the end of its source — leaves no hole, so
  // everything after it still lands where the reader put it.
  let placed = 0;

  for (const page of state.pages) {
    if (page.origin.asset === ORIGINAL) {
      placed += 1;
      continue;
    }

    const bytes = assets.get(page.origin.asset);
    if (!bytes) continue;

    let source = loaded.get(page.origin.asset);
    if (!source) {
      source = await loadPdf(bytes, { updateMetadata: false });
      loaded.set(page.origin.asset, source);
    }
    if (page.origin.index >= source.getPageCount()) continue;

    const [copied] = await document.copyPages(source, [page.origin.index]);
    document.insertPage(Math.min(placed, document.getPageCount()), copied);
    byId.set(page.id, copied);
    placed += 1;
  }
}

async function drawMark(
  document: PDFDocument,
  page: PDFPage,
  mark: Mark,
  assets: ReadonlyMap<string, Uint8Array>,
  fonts: Map<string, Awaited<ReturnType<PDFDocument['embedFont']>>>,
  images: Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>
): Promise<void> {
  switch (mark.kind) {
    case 'text': {
      const name = standardFontFor(mark.font);
      let font = fonts.get(name);
      if (!font) {
        font = await document.embedFont(name as StandardFonts);
        fonts.set(name, font);
      }
      // The standard fonts speak WinAnsi. A character outside it makes pdf-lib
      // throw from inside drawText, which would fail every rebuild from here
      // on and leave the reader with an opaque error on an editor that no
      // longer responds. Named here instead, so the message can say which one.
      const unsupported = firstUnsupportedCharacter(mark.text, font);
      if (unsupported !== null) throw new UnsupportedCharacterError(unsupported);

      page.drawText(mark.text, {
        x: mark.x,
        y: mark.y,
        size: mark.size,
        font,
        color: colorOf(mark.color),
        rotate: degrees(mark.rotate),
      });
      return;
    }

    case 'rect': {
      page.drawRectangle({
        x: mark.x,
        y: mark.y,
        width: mark.width,
        height: mark.height,
        color: mark.color ? colorOf(mark.color) : undefined,
        borderColor: mark.borderColor ? colorOf(mark.borderColor) : undefined,
        borderWidth: mark.borderWidth,
        opacity: mark.color ? mark.opacity : undefined,
        borderOpacity: mark.borderColor ? mark.opacity : undefined,
      });
      return;
    }

    case 'image': {
      const bytes = assets.get(mark.asset);
      if (!bytes) return;
      let image = images.get(mark.asset);
      if (!image) {
        const kind = imageKind(bytes);
        if (kind === null) return;
        image =
          kind === 'png' ? await document.embedPng(bytes) : await document.embedJpg(bytes);
        images.set(mark.asset, image);
      }
      page.drawImage(image, {
        x: mark.x,
        y: mark.y,
        width: mark.width,
        height: mark.height,
        opacity: mark.opacity,
      });
      return;
    }

    case 'ink': {
      // Segment by segment rather than as an SVG path: pdf-lib's path drawing
      // uses its own top-left convention, and a stroke that lands in the wrong
      // place is worse than one drawn the obvious way.
      for (let index = 1; index < mark.points.length; index += 1) {
        const [x1, y1] = mark.points[index - 1];
        const [x2, y2] = mark.points[index];
        page.drawLine({
          start: { x: x1, y: y1 },
          end: { x: x2, y: y2 },
          color: colorOf(mark.color),
          thickness: mark.width,
          lineCap: LineCapStyle.Round,
        });
      }
      // A single tap still leaves a dot.
      if (mark.points.length === 1) {
        const [x, y] = mark.points[0];
        page.drawCircle({ x, y, size: mark.width / 2, color: colorOf(mark.color) });
      }
    }
  }
}

export async function materialize({
  original,
  assets,
  state,
}: MaterializeInput): Promise<Uint8Array> {
  // Nothing asked for means nothing done. The reader gets the file they opened,
  // byte for byte, rather than a re-encoded copy that merely resembles it.
  const originalCount = state.pages.filter((page) => page.origin.asset === ORIGINAL).length;
  if (isUntouched(state, originalCount) && state.pages.length === originalCount) {
    const untouched = await loadPdf(original, { updateMetadata: false });
    if (untouched.getPageCount() === originalCount) return original.slice();
  }

  const document = await loadPdf(original, { updateMetadata: false });

  const { pages: byId, deleted } = arrangeOriginalPages(document, state.pages);

  // Emptied before they are collected: a dangling reference — a bookmark whose
  // destination is a deleted page — would otherwise keep the page, and
  // everything it carried, inside the exported file.
  for (const page of deleted) {
    page.node.delete(PDFName.of('Contents'));
    page.node.delete(PDFName.of('Resources'));
    page.node.delete(PDFName.of('Annots'));
    page.node.delete(PDFName.of('Thumb'));
  }

  await insertImportedPages(document, state, assets, byId);

  for (const page of state.pages) {
    const handle = byId.get(page.id);
    if (!handle) continue;
    if (page.turns !== 0) {
      handle.setRotation(degrees((((handle.getRotation().angle + page.turns * 90) % 360) + 360) % 360));
    }
    if (page.crop) {
      handle.setCropBox(page.crop.x, page.crop.y, page.crop.width, page.crop.height);
    }
  }

  const fonts = new Map<string, Awaited<ReturnType<PDFDocument['embedFont']>>>();
  const images = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>();
  for (const mark of state.marks) {
    const handle = byId.get(mark.page);
    if (!handle) continue;
    await drawMark(document, handle, mark, assets, fonts, images);
  }

  // Page labels bind to page indices, so any change to the sequence makes them
  // point at the wrong pages. Dropping them beats handing back wrong ones.
  const sequenceChanged =
    state.pages.length !== originalCount ||
    state.pages.some(
      (page, index) => page.origin.asset !== ORIGINAL || page.origin.index !== index
    );
  if (sequenceChanged) document.catalog.delete(PDFName.of('PageLabels'));

  removeUnreachableObjects(document, { stopAt: deleted.map((page) => page.ref) });

  return savePdf(document);
}
