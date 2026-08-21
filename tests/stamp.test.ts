import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFStream, StandardFonts, degrees } from 'pdf-lib';
import { applyPageEdits } from '@/lib/pageEdits';
import { visualSize, pageBoxOf } from '@/lib/geometry';
import {
  firstUnsupportedCharacter,
  hexToRgb,
  imageKind,
  pageNumberText,
  stampImage,
  stampPageNumbers,
  stampText,
  standardFontFor,
  UnsupportedCharacterError,
  type NumberStamp,
} from '@/lib/stamp';

const MARGIN = 36;
const SIZE = 12;

const numberStamp = (overrides: Partial<NumberStamp> = {}): NumberStamp => ({
  font: { family: 'helvetica', bold: false, italic: false },
  size: SIZE,
  color: { r: 0, g: 0, b: 0 },
  anchor: 'bottom-right',
  margin: MARGIN,
  startAt: 1,
  format: 'plain',
  ofWord: 'de',
  ...overrides,
});

/** Where a stamped string sits on screen, and which way it runs. */
async function measure(bytes: Uint8Array, pageNumber: number, needle: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const page = await (await task.promise).getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const item = content.items.find(
    (candidate) => 'str' in candidate && candidate.str.includes(needle)
  ) as { transform: number[]; str: string } | undefined;
  await task.destroy();
  if (!item) return null;

  const [a, b, , , e, f] = item.transform;
  const [sx, sy] = viewport.convertToViewportPoint(e, f);
  // pdf.js folds the font size into the text transform, so this step is
  // `size` long, not 1. Normalising turns it into the direction the text runs.
  const [ux, uy] = viewport.convertToViewportPoint(e + a, f + b);
  const length = Math.hypot(ux - sx, uy - sy) || 1;

  return {
    viewport: { width: viewport.width, height: viewport.height },
    start: { x: sx, y: sy },
    direction: { x: (ux - sx) / length, y: (uy - sy) / length },
    text: item.str,
  };
}

async function helveticaWidth(text: string, size = SIZE): Promise<number> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  return font.widthOfTextAtSize(text, size);
}

describe('pageNumberText', () => {
  it('prints a bare number, or the number out of the count actually stamped', () => {
    const plain = numberStamp();
    expect(pageNumberText(plain, 0, 10)).toBe('1');
    expect(pageNumberText(plain, 9, 10)).toBe('10');

    const ofTotal = numberStamp({ format: 'ofTotal', startAt: 1 });
    expect(pageNumberText(ofTotal, 0, 10)).toBe('1 de 10');
    expect(pageNumberText(ofTotal, 9, 10)).toBe('10 de 10');
  });

  it('keeps both ends true when the numbering starts past one', () => {
    // Numbering 5 pages but calling the first one 3: the last is 7, so the
    // total printed must be 7, not 5.
    const stamp = numberStamp({ format: 'ofTotal', startAt: 3 });
    expect(pageNumberText(stamp, 0, 5)).toBe('3 de 7');
    expect(pageNumberText(stamp, 4, 5)).toBe('7 de 7');
  });
});

describe('font handling', () => {
  it('maps family, weight and slant onto the standard fonts', () => {
    expect(standardFontFor({ family: 'times', bold: true, italic: true })).toBe(
      StandardFonts.TimesRomanBoldItalic
    );
    expect(standardFontFor({ family: 'courier', bold: false, italic: true })).toBe(
      StandardFonts.CourierOblique
    );
    expect(standardFontFor({ family: 'helvetica', bold: true, italic: false })).toBe(
      StandardFonts.HelveticaBold
    );
  });

  it('accepts Spanish and names the character it cannot draw', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    expect(firstUnsupportedCharacter('Página 3 de 40 — ñ ü', font)).toBeNull();
    expect(firstUnsupportedCharacter('borrador 第 3', font)).toBe('第');
  });

  it('refuses a watermark it cannot draw, saying which character', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 600]);
    await expect(
      stampText(doc, [1], {
        text: 'confidencial 🙂',
        font: { family: 'helvetica', bold: false, italic: false },
        size: 24,
        color: { r: 0, g: 0, b: 0 },
        opacity: 0.3,
        angle: 45,
        anchor: 'center',
        margin: MARGIN,
      })
    ).rejects.toBeInstanceOf(UnsupportedCharacterError);
  });
});

describe('hexToRgb', () => {
  it('reads the six-digit forms a colour input produces', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });

    const slate = hexToRgb('#3D5A80');
    expect(slate.r).toBeCloseTo(0x3d / 255, 6);
    expect(slate.g).toBeCloseTo(0x5a / 255, 6);
    expect(slate.b).toBeCloseTo(0x80 / 255, 6);
  });

  it('falls back to black rather than to NaN channels', () => {
    // rgb() throws on NaN, so a bad value here would take down the whole stamp.
    expect(hexToRgb('nope')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('')).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('imageKind', () => {
  it('reads the magic bytes', () => {
    expect(imageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe('png');
    expect(imageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(imageKind(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();
  });
});

describe('page numbers on a page our own Organize tool rotated', () => {
  // This is the stage gate, spelled out: rotate a page with the shipped
  // Organize engine, number it, and require the number to read upright and sit
  // in the corner the reader picked — measured through pdf.js, not asserted.
  it('lands upright in the bottom-right corner, whatever the rotation', async () => {
    for (const rotation of [0, 90, 180, 270]) {
      const source = await PDFDocument.create();
      source.addPage([400, 600]);
      source.addPage([400, 600]);
      const original = (await source.save()).slice();

      const rotated = await applyPageEdits(original, [
        { sourceIndex: 0, rotation: 0 },
        { sourceIndex: 1, rotation },
      ]);

      const doc = await PDFDocument.load(rotated);
      await stampPageNumbers(doc, [1, 2], numberStamp());
      const out = (await doc.save()).slice();

      const label = '2';
      const width = await helveticaWidth(label);
      const found = await measure(out, 2, label);
      const where = `rotación ${rotation}`;

      expect(found, `número presente, ${where}`).not.toBeNull();
      // Upright: the baseline runs to screen-right and stays level.
      expect(found!.direction.x, `dirección x, ${where}`).toBeCloseTo(1, 4);
      expect(found!.direction.y, `dirección y, ${where}`).toBeCloseTo(0, 4);
      // Bottom-right of the page AS DISPLAYED, one margin in from each edge.
      expect(found!.start.x, `borde derecho, ${where}`).toBeCloseTo(
        found!.viewport.width - MARGIN - width,
        3
      );
      expect(found!.start.y, `borde inferior, ${where}`).toBeCloseTo(
        found!.viewport.height - MARGIN,
        3
      );
    }
  });

  it('honours every corner on a rotated page', async () => {
    const source = await PDFDocument.create();
    source.addPage([400, 600]);
    const rotated = await applyPageEdits((await source.save()).slice(), [
      { sourceIndex: 0, rotation: 90 },
    ]);

    const width = await helveticaWidth('1');

    for (const anchor of ['top-left', 'top-right', 'bottom-left', 'bottom-center'] as const) {
      const doc = await PDFDocument.load(rotated);
      await stampPageNumbers(doc, [1], numberStamp({ anchor }));
      const found = await measure((await doc.save()).slice(), 1, '1');

      expect(found, `${anchor} presente`).not.toBeNull();
      const [vertical, horizontal] = anchor.split('-');
      const expectedX =
        horizontal === 'left'
          ? MARGIN
          : horizontal === 'right'
            ? found!.viewport.width - MARGIN - width
            : (found!.viewport.width - width) / 2;
      const expectedY =
        vertical === 'top' ? MARGIN + 0 : found!.viewport.height - MARGIN;

      expect(found!.start.x, `${anchor} x`).toBeCloseTo(expectedX, 3);
      // The top anchor puts the block's TOP at the margin, so its baseline sits
      // one ink height below that.
      if (vertical === 'top') {
        expect(found!.start.y, `${anchor} y`).toBeGreaterThan(MARGIN);
        expect(found!.start.y, `${anchor} y`).toBeLessThan(MARGIN + SIZE);
      } else {
        expect(found!.start.y, `${anchor} y`).toBeCloseTo(expectedY, 3);
      }
    }
  });

  it('places correctly on a page whose crop box does not start at the origin', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 600]);
    page.setCropBox(20, 35, 300, 500);
    page.setRotation(degrees(90));

    await stampPageNumbers(doc, [1], numberStamp());
    const out = (await doc.save()).slice();

    const width = await helveticaWidth('1');
    const found = await measure(out, 1, '1');
    const visual = visualSize(pageBoxOf(page));

    expect(found).not.toBeNull();
    // The viewport comes from the crop box, so a correct placement is measured
    // against the visible area — not against the media box.
    expect(found!.viewport.width).toBeCloseTo(visual.width, 6);
    expect(found!.start.x).toBeCloseTo(found!.viewport.width - MARGIN - width, 3);
    expect(found!.start.y).toBeCloseTo(found!.viewport.height - MARGIN, 3);
    expect(found!.direction.x).toBeCloseTo(1, 4);
  });
});

describe('watermarks', () => {
  it('centres a tilted watermark on the page it was placed on', async () => {
    for (const rotation of [0, 90, 270]) {
      const doc = await PDFDocument.create();
      const page = doc.addPage([400, 600]);
      page.setRotation(degrees(rotation));

      const text = 'BORRADOR';
      const angle = 45;
      await stampText(doc, [1], {
        text,
        font: { family: 'helvetica', bold: true, italic: false },
        size: 48,
        color: { r: 0.5, g: 0.5, b: 0.5 },
        opacity: 0.25,
        angle,
        anchor: 'center',
        margin: MARGIN,
      });

      const found = await measure((await doc.save()).slice(), 1, text);
      expect(found, `marca presente, rotación ${rotation}`).not.toBeNull();

      // Reconstruct the centre from the baseline start and the direction it
      // runs: it must sit on the middle of the page as displayed.
      const boldDoc = await PDFDocument.create();
      const boldFont = await boldDoc.embedFont(StandardFonts.HelveticaBold);
      const width = boldFont.widthOfTextAtSize(text, 48);
      const height = boldFont.heightAtSize(48, { descender: false });

      const dir = found!.direction;
      // Perpendicular, pointing to the visual "up" side of the baseline.
      const perpendicular = { x: dir.y, y: -dir.x };
      const centreX = found!.start.x + (dir.x * width) / 2 + (perpendicular.x * height) / 2;
      const centreY = found!.start.y + (dir.y * width) / 2 + (perpendicular.y * height) / 2;

      expect(centreX, `centro x, rotación ${rotation}`).toBeCloseTo(found!.viewport.width / 2, 2);
      expect(centreY, `centro y, rotación ${rotation}`).toBeCloseTo(found!.viewport.height / 2, 2);

      // And it really is tilted 45 degrees on screen.
      const degreesOnScreen = (Math.atan2(-dir.y, dir.x) * 180) / Math.PI;
      expect(degreesOnScreen, `ángulo, rotación ${rotation}`).toBeCloseTo(angle, 3);
    }
  });

  it('stamps only the pages it was given', async () => {
    const doc = await PDFDocument.create();
    for (let index = 0; index < 4; index += 1) doc.addPage([400, 600]);

    await stampText(doc, [2, 4], {
      text: 'MUESTRA',
      font: { family: 'helvetica', bold: false, italic: false },
      size: 24,
      color: { r: 0, g: 0, b: 0 },
      opacity: 1,
      angle: 0,
      anchor: 'center',
      margin: MARGIN,
    });
    const out = (await doc.save()).slice();

    expect(await measure(out, 1, 'MUESTRA')).toBeNull();
    expect(await measure(out, 2, 'MUESTRA')).not.toBeNull();
    expect(await measure(out, 3, 'MUESTRA')).toBeNull();
    expect(await measure(out, 4, 'MUESTRA')).not.toBeNull();
  });

  it('embeds an image watermark once however many pages it lands on', async () => {
    // A 1x1 PNG is enough: what matters is that the count does not grow with
    // the pages. (A transparent PNG embeds two XObjects — the image and its
    // soft mask — so the invariant is "same for 1 page as for 20", not "one".)
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      ),
      (character) => character.charCodeAt(0)
    );
    expect(imageKind(png)).toBe('png');

    const countImages = async (pageCount: number) => {
      const doc = await PDFDocument.create();
      for (let index = 0; index < pageCount; index += 1) doc.addPage([400, 600]);
      await stampImage(
        doc,
        Array.from({ length: pageCount }, (_, index) => index + 1),
        {
          bytes: png,
          opacity: 0.4,
          angle: 0,
          anchor: 'bottom-right',
          margin: MARGIN,
          widthFraction: 0.25,
        }
      );
      const out = await PDFDocument.load((await doc.save()).slice());
      return out.context
        .enumerateIndirectObjects()
        .filter(
          ([, object]) =>
            object instanceof PDFStream &&
            object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
        ).length;
    };

    const one = await countImages(1);
    expect(one).toBeGreaterThan(0);
    expect(await countImages(20)).toBe(one);
  });

  it('refuses an image that is neither PNG nor JPEG', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 600]);
    await expect(
      stampImage(doc, [1], {
        bytes: new Uint8Array([1, 2, 3, 4]),
        opacity: 1,
        angle: 0,
        anchor: 'center',
        margin: MARGIN,
        widthFraction: 0.5,
      })
    ).rejects.toThrow(/PNG or a JPEG/i);
  });
});
