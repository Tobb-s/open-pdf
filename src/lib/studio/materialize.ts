import {
  LineCapStyle,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFName,
  PDFPage,
  PDFRadioGroup,
  PDFRef,
  PDFTextField,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import { annotationRefs, dropFieldsWithoutWidgets } from '@/lib/acroform';
import { removeUnreachableObjects } from '@/lib/pdfGc';
import { loadPdf, savePdf } from '@/lib/pdfio';
import {
  firstUnsupportedCharacter,
  imageKind,
  stampPageNumbersOn,
  stampTextOn,
  standardFontFor,
  UnsupportedCharacterError,
} from '@/lib/stamp';
import { pageBoxOf, visualSize } from '@/lib/geometry';
import { addReviewAnnotation } from '@/lib/studio/reviewAnnotations';
import { toWinAnsi } from '@/lib/ocr';
import { buildSignatureAudit, signatureAuditBytes } from '@/lib/studio/signatureAudit';
import {
  IMAGE_PAGE_LONG_SIDE,
  isUntouched,
  type PageId,
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

/**
 * Whether a page comes from an imported image rather than from a PDF.
 *
 * An image has no page tree to copy from, so it gets a page of its own sized to
 * its shape: the longest side is a fixed length and the aspect is kept, which
 * turns a photo of any resolution into something the size of a sheet of paper
 * rather than something the size of its pixel count.
 */
function isImageAsset(bytes: Uint8Array | undefined): boolean {
  return bytes !== undefined && imageKind(bytes) !== null;
}

/**
 * Removes the form controls an imported page brought without its form.
 *
 * `copyPages` copies a page's annotations, so a page taken from a document with
 * a form arrives carrying its widgets — while the AcroForm those widgets
 * belonged to stays behind. Measured: importing one such page left a widget in
 * the file that no field owned. It draws like a box you can type in and is
 * nothing of the sort.
 *
 * Leaving it would make the editor's own declaration — that the fields did not
 * travel — technically true and practically misleading. So the boxes go too,
 * and what the reader is told matches what they get. Links, notes and every
 * other annotation are untouched.
 */
function dropOrphanedWidgets(page: PDFPage): void {
  const annots = page.node.Annots();
  if (!annots) return;

  for (let index = annots.size() - 1; index >= 0; index -= 1) {
    const entry = annots.get(index);
    const dict = entry instanceof PDFRef ? page.doc.context.lookup(entry) : entry;
    if (!(dict instanceof PDFDict)) continue;
    if (dict.get(PDFName.of('Subtype')) === PDFName.of('Widget')) annots.remove(index);
  }
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

    if (isImageAsset(bytes)) {
      const kind = imageKind(bytes);
      // The magic bytes say PNG or JPEG; the rest of the file may still be
      // something pdf-lib cannot read. A truncated photo must cost its own page,
      // not every rebuild from here until the reader guesses what to undo.
      let image;
      try {
        image = kind === 'png' ? await document.embedPng(bytes) : await document.embedJpg(bytes);
      } catch {
        continue;
      }
      const scale = IMAGE_PAGE_LONG_SIDE / Math.max(image.width, image.height);
      const width = image.width * scale;
      const height = image.height * scale;

      const made = document.insertPage(Math.min(placed, document.getPageCount()), [width, height]);
      made.drawImage(image, { x: 0, y: 0, width, height });
      byId.set(page.id, made);
      placed += 1;
      continue;
    }

    let source = loaded.get(page.origin.asset);
    if (!source) {
      source = await loadPdf(bytes, { updateMetadata: false });
      loaded.set(page.origin.asset, source);
    }
    if (page.origin.index >= source.getPageCount()) continue;

    const [copied] = await document.copyPages(source, [page.origin.index]);
    dropOrphanedWidgets(copied);
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

    case 'signature': {
      const bytes = assets.get(mark.asset);
      if (!bytes) return;
      let image = images.get(mark.asset);
      if (!image) {
        const kind = imageKind(bytes);
        if (kind === null) return;
        image = kind === 'png' ? await document.embedPng(bytes) : await document.embedJpg(bytes);
        images.set(mark.asset, image);
      }

      const captionFontName = standardFontFor({ family: 'helvetica', bold: false, italic: false });
      let captionFont = fonts.get(captionFontName);
      if (!captionFont) {
        captionFont = await document.embedFont(captionFontName as StandardFonts);
        fonts.set(captionFontName, captionFont);
      }
      const caption = toWinAnsi(`${mark.signer} · ${mark.signedOn}`);
      const captionSize = Math.min(
        7,
        caption === '' ? 7 : (mark.width * 7) / captionFont.widthOfTextAtSize(caption, 7)
      );

      page.drawImage(image, {
        x: mark.x,
        y: mark.y + 16,
        width: mark.width,
        height: mark.height,
      });
      page.drawLine({
        start: { x: mark.x, y: mark.y + 14 },
        end: { x: mark.x + mark.width, y: mark.y + 14 },
        thickness: 0.7,
        color: rgb(0.25, 0.29, 0.36),
      });
      if (caption !== '') {
        page.drawText(caption, {
          x: mark.x,
          y: mark.y + 4,
          size: Math.max(captionSize, 4),
          font: captionFont,
          color: rgb(0.25, 0.29, 0.36),
        });
      }
      return;
    }

    case 'ocr': {
      // Drawn at zero opacity: the words are there to be found and selected,
      // not to be seen. The page underneath is what the reader looks at.
      const name = standardFontFor({ family: 'helvetica', bold: false, italic: false });
      let font = fonts.get(name);
      if (!font) {
        font = await document.embedFont(name as StandardFonts);
        fonts.set(name, font);
      }
      for (const word of mark.words) {
        // One word that will not encode must not cost the whole layer.
        if (firstUnsupportedCharacter(word.text, font) !== null) continue;
        page.drawText(word.text, {
          x: word.x,
          y: word.y,
          size: word.size,
          font,
          color: rgb(0, 0, 0),
          opacity: 0,
          rotate: degrees(mark.rotate),
        });
      }
      return;
    }

    case 'textLayer': {
      const name = standardFontFor({ family: 'helvetica', bold: false, italic: false });
      let font = fonts.get(name);
      if (!font) {
        font = await document.embedFont(name as StandardFonts);
        fonts.set(name, font);
      }
      for (const word of mark.words) {
        if (firstUnsupportedCharacter(word.text, font) !== null) continue;
        page.drawText(word.text, {
          x: word.x,
          y: word.y,
          size: word.size,
          font,
          color: rgb(0, 0, 0),
          opacity: 0,
          rotate: degrees(word.rotate),
        });
      }
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
      return;
    }

    case 'highlight':
    case 'underline':
    case 'strikeout':
    case 'comment':
      addReviewAnnotation(document, page, mark);
      return;
  }
}

/**
 * What was built, and which pages are really in it.
 *
 * `pages` is not the same list as `state.pages`, and the difference is the
 * point. A page whose image will not embed, whose asset is missing, or whose
 * index is past the end of its source is skipped rather than allowed to kill
 * the whole build — the right instinct, since one bad photo must not cost the
 * reader their afternoon. What was missing is telling the caller it happened.
 *
 * Without it every index the editor holds is one out of step from that page
 * onward: the reader draws on a page they are not looking at, and the export's
 * redaction check reads the text of the WRONG page, finds nothing to look for,
 * and reports the document clean without having examined the region that was
 * painted out. A check that cannot fail is worse than no check.
 */
export interface MaterializeResult {
  bytes: Uint8Array;
  /** The ids really in the produced document, in the order it holds them. */
  pages: PageId[];
}

export async function materialize({
  original,
  assets,
  state,
}: MaterializeInput): Promise<MaterializeResult> {
  // Nothing asked for means nothing done. The reader gets the file they opened,
  // byte for byte, rather than a re-encoded copy that merely resembles it.
  const originalCount = state.pages.filter((page) => page.origin.asset === ORIGINAL).length;
  if (isUntouched(state, originalCount) && state.pages.length === originalCount) {
    const untouched = await loadPdf(original, { updateMetadata: false });
    if (untouched.getPageCount() === originalCount) {
      return { bytes: original.slice(), pages: state.pages.map((page) => page.id) };
    }
  }

  const document = await loadPdf(original, { updateMetadata: false });

  const { pages: byId, deleted } = arrangeOriginalPages(document, state.pages);

  /** Annotation references that left with a page, by whatever means. */
  const strippedAnnots = new Set<string>();

  // Emptied before they are collected: a dangling reference — a bookmark whose
  // destination is a deleted page — would otherwise keep the page, and
  // everything it carried, inside the exported file.
  //
  // The annotations are noted before they go. A widget carries its field's
  // value, but the value itself lives in the form, which hangs off the
  // catalogue and survives a page's deletion untouched — so deleting the page
  // someone's name was typed on used to leave the name in the file while the
  // result card reported the form as LOST.
  for (const page of deleted) {
    for (const tag of annotationRefs(page)) strippedAnnots.add(tag);
    page.node.delete(PDFName.of('Contents'));
    page.node.delete(PDFName.of('Resources'));
    page.node.delete(PDFName.of('Annots'));
    page.node.delete(PDFName.of('Thumb'));
  }

  await insertImportedPages(document, state, assets, byId);

  /**
   * Turning and cropping, before anything measures the page.
   *
   * The order matters and was wrong once. A rasterised page is sized from the
   * box it presents, and the bitmap it receives was rendered from this same
   * script state — crop and turns already applied. Measuring the page BEFORE
   * applying them meant a cropped page kept its original size and the picture
   * was stretched edge to edge to fill it, and a quarter-turned page came out
   * squashed. Nothing caught it: the painted regions were still black, so the
   * export check passed and handed over the distorted file as correct.
   */
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

  /**
   * Replacing a page with a picture of itself.
   *
   * This is what makes redaction real. The bitmap arrives with the regions
   * already painted out, so what was under them is not covered — it is not in
   * the bitmap, and the page's own content, fonts and images are unlinked here
   * and collected at the end.
   *
   * The page comes out flat: the size it LOOKED — crop and turns included,
   * because those were applied just above — with no rotation and no crop left.
   * Keeping a /Rotate would turn the picture again, and keeping a crop would
   * hide part of a page that is now nothing but the picture.
   */
  for (const page of state.pages) {
    if (!page.raster) continue;
    const handle = byId.get(page.id);
    if (!handle) continue;
    const bytes = assets.get(page.raster.asset);
    if (!bytes) continue;

    const kind = imageKind(bytes);
    if (kind === null) continue;
    let image;
    try {
      image = kind === 'png' ? await document.embedPng(bytes) : await document.embedJpg(bytes);
    } catch {
      continue;
    }

    // The size the page looked before it became a picture.
    const box = pageBoxOf(handle);
    const visual = visualSize(box);

    // Same reason as for a deleted page: the widget goes, and the field it
    // draws has to go with it or the value stays behind, undrawn.
    for (const tag of annotationRefs(handle)) strippedAnnots.add(tag);

    handle.node.delete(PDFName.of('Contents'));
    handle.node.delete(PDFName.of('Resources'));
    handle.node.delete(PDFName.of('Annots'));
    handle.node.delete(PDFName.of('Thumb'));
    handle.setRotation(degrees(0));
    handle.setMediaBox(0, 0, visual.width, visual.height);
    handle.setCropBox(0, 0, visual.width, visual.height);
    handle.drawImage(image, { x: 0, y: 0, width: visual.width, height: visual.height });
  }

  // Whatever lost its last widget above — to a deletion or to a rasterisation —
  // leaves the form as well. See src/lib/acroform.ts for why this is not
  // optional, and for the direction of the error it prevents.
  dropFieldsWithoutWidgets(document, strippedAnnots);

  const fonts = new Map<string, Awaited<ReturnType<PDFDocument['embedFont']>>>();
  const images = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>();
  for (const mark of state.marks) {
    const handle = byId.get(mark.page);
    if (!handle) continue;
    await drawMark(document, handle, mark, assets, fonts, images);
  }

  // One inspectable record per electronic signature. This is evidence about
  // what OpenPDF placed, not a certificate and not an identity assertion.
  const placedPageIds = state.pages.filter((page) => byId.has(page.id)).map((page) => page.id);
  for (const mark of state.marks) {
    if (mark.kind !== 'signature') continue;
    const appearance = assets.get(mark.asset);
    const pageNumber = placedPageIds.indexOf(mark.page) + 1;
    if (!appearance || pageNumber === 0) continue;

    const record = await buildSignatureAudit(mark, appearance, pageNumber);
    const timestamp = new Date(mark.signedAt);
    await document.attach(
      signatureAuditBytes(record),
      `openpdf-signature-audit-${mark.id}.json`,
      {
        mimeType: 'application/json',
        description: 'OpenPDF electronic signature audit record',
        creationDate: Number.isNaN(timestamp.getTime()) ? undefined : timestamp,
        modificationDate: Number.isNaN(timestamp.getTime()) ? undefined : timestamp,
      }
    );
  }

  // Form field values.
  //
  // Two things here were learned the hard way. Appearances are regenerated for
  // the fields the reader actually wrote, never for the whole form: asking
  // pdf-lib to do the whole form re-typesets every field that happens to lack
  // an appearance stream, rewriting the typeface of fields nobody touched.
  //
  // And the regeneration is done HERE rather than inside `save`, because it
  // draws with a WinAnsi font and throws on a character it cannot encode. From
  // inside `save` that throw escapes `materialize` entirely and kills the
  // export and every later rebuild with an opaque error — the same failure this
  // file already guards against for text marks, and which the form path was
  // quietly missing.
  if (Object.keys(state.fields).length > 0) {
    try {
      const form = document.getForm();
      const written: Array<{ name: string; field: PDFField }> = [];

      for (const [name, value] of Object.entries(state.fields)) {
        try {
          const field = form.getField(name);
          if (field instanceof PDFTextField) field.setText(value);
          else if (field instanceof PDFCheckBox) {
            if (value === 'true') field.check();
            else field.uncheck();
          } else if (field instanceof PDFDropdown) {
            if (value === '') field.clear();
            else field.select(value);
          } else if (field instanceof PDFRadioGroup) {
            if (value === '') field.clear();
            else field.select(value);
          }
          written.push({ name, field });
        } catch {
          // One field that refuses a value is reported by the round trip, not
          // by taking the whole document down.
        }
      }

      if (written.length > 0) {
        const helvetica = await document.embedFont(StandardFonts.Helvetica);
        for (const { name, field } of written) {
          const value = state.fields[name] ?? '';
          const unsupported = firstUnsupportedCharacter(value, helvetica);
          if (unsupported !== null) throw new UnsupportedCharacterError(unsupported);
          try {
            field.defaultUpdateAppearances(helvetica);
          } catch {
            // No appearance for this one; the round trip on the produced file
            // is what decides whether that matters.
          }
        }
      }

      if (state.flattenForms) {
        // The fields become fixed content: still readable, no longer fillable.
        //
        // This runs AFTER the appearances above, and the order is the whole
        // point: flattening copies each field's appearance stream into the
        // page, so flattening first would bake in the value the document
        // arrived with and silently discard what the reader typed. Whole-form
        // regeneration stays off because the loop above already did it for the
        // fields that needed it.
        form.flatten({ updateFieldAppearances: false });
      }
    } catch (caught) {
      // An unencodable character is the reader's to fix and must reach them.
      if (caught instanceof UnsupportedCharacterError) throw caught;
      // Anything else means there is no usable form here any more.
    }
  } else if (state.flattenForms) {
    try {
      document.getForm().flatten({ updateFieldAppearances: false });
    } catch {
      // Nothing to flatten.
    }
  }

  if (state.metadata.title !== undefined) document.setTitle(state.metadata.title);
  if (state.metadata.author !== undefined) document.setAuthor(state.metadata.author);
  if (state.metadata.language !== undefined) document.setLanguage(state.metadata.language);

  // The stage-two tools, as document settings rather than as marks: the numbers
  // come from the FINAL order, so reordering pages renumbers them.
  //
  // The pages are passed as handles, in script order. Turning them into indices
  // for the stamps to turn back would depend on pdf-lib's page cache being
  // fresh at that exact moment — and `removePage` does not refresh it. The
  // handles are the same objects either way.
  const stampable = (wanted: readonly string[] | null) =>
    state.pages
      .filter((page) => wanted === null || wanted.includes(page.id))
      .map((page) => byId.get(page.id))
      .filter((page): page is PDFPage => page !== undefined);

  if (state.watermark) {
    const spec = state.watermark;
    const pages = stampable(spec.pages);
    if (pages.length > 0) {
      await stampTextOn(document, pages, {
        text: spec.text,
        font: spec.font,
        size: spec.size,
        color: spec.color,
        opacity: spec.opacity,
        angle: spec.angle,
        anchor: spec.anchor,
        margin: spec.margin,
      });
    }
  }

  if (state.numbering) {
    const spec = state.numbering;
    const pages = stampable(spec.pages);
    if (pages.length > 0) {
      await stampPageNumbersOn(document, pages, {
        font: spec.font,
        size: spec.size,
        color: spec.color,
        anchor: spec.anchor,
        margin: spec.margin,
        startAt: spec.startAt,
        format: spec.format,
        ofWord: spec.ofWord,
      });
    }
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

  // Never the whole form: the appearances that needed regenerating were
  // regenerated above, for the fields the reader wrote and no others.
  /**
   * Which pages are really there, read from the page tree rather than from the
   * script that asked for them.
   *
   * The tree is walked directly instead of through `getPages()` because
   * pdf-lib's page cache is not invalidated by `removePage` — the same quirk
   * `arrangeOriginalPages` works around above — so a build whose last
   * structural act was a deletion would report pages no longer in the file.
   */
  const idByRef = new Map<string, PageId>();
  for (const [id, handle] of byId) idByRef.set(handle.ref.tag, id);

  const inDocument: PageId[] = [];
  document.catalog.Pages().traverse((node, ref) => {
    if (node.get(PDFName.of('Type'))?.toString() !== '/Page') return;
    const id = idByRef.get(ref.tag);
    if (id !== undefined) inDocument.push(id);
  });

  return {
    bytes: await savePdf(document, { updateFieldAppearances: false }),
    pages: inDocument,
  };
}
