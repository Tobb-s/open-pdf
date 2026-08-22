import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import {
  anchorBlock,
  originForRotatedCenter,
  pageBoxOf,
  uprightTextRotation,
  visualSize,
  visualUpToPdfPoint,
  type Anchor,
} from '@/lib/geometry';

/**
 * Drawing things on top of pages that already exist: watermarks and page
 * numbers.
 *
 * Everything here places its content through geometry.ts rather than by
 * dividing page dimensions, so a page carrying /Rotate or a CropBox that does
 * not start at the origin is handled from the first line rather than patched
 * later. That is the whole reason these two tools waited for that module.
 *
 * Two pdf-lib behaviours this relies on, both verified rather than assumed:
 * drawText and drawImage wrap their own operators in q/Q, and pdf-lib
 * additionally wraps a loaded page's ORIGINAL content in q/Q the first time it
 * draws on it — so a sloppy generator that left a transformation hanging cannot
 * displace what we add.
 */

export type FontFamily = 'helvetica' | 'times' | 'courier';

export const FONT_FAMILIES: readonly FontFamily[] = ['helvetica', 'times', 'courier'];

export interface FontChoice {
  family: FontFamily;
  bold: boolean;
  italic: boolean;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The 12 standard fonts, addressed as family plus weight plus slant. */
export function standardFontFor({ family, bold, italic }: FontChoice): StandardFonts {
  if (family === 'times') {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (family === 'courier') {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

/**
 * The standard fonts speak WinAnsi, which covers Spanish and the rest of
 * Latin-1 but not, say, Greek or an emoji. pdf-lib throws mid-draw on the first
 * character it cannot encode; finding it first means the reader is told which
 * character is the problem instead of watching the tool fail.
 */
export function firstUnsupportedCharacter(text: string, font: PDFFont): string | null {
  for (const character of text) {
    try {
      font.encodeText(character);
    } catch {
      return character;
    }
  }
  return null;
}

export class UnsupportedCharacterError extends Error {
  readonly character: string;

  constructor(character: string) {
    super(`The chosen font cannot draw ${character}.`);
    this.name = 'UnsupportedCharacterError';
    this.character = character;
  }
}

/** `#3d5a80` to the 0-to-1 channels pdf-lib wants. Anything unreadable is black. */
export function hexToRgb(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return { r: 0, g: 0, b: 0 };
  const value = Number.parseInt(match[1], 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}

/** PNG and JPEG are what pdf-lib can embed; the magic bytes decide which. */
export function imageKind(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

/** Resolves 1-based page numbers to handles, dropping any that do not exist. */
function pagesByNumber(document: PDFDocument, numbers: readonly number[]): PDFPage[] {
  const pages = document.getPages();
  return numbers
    .map((number) => pages[number - 1])
    .filter((page): page is PDFPage => page !== undefined);
}

interface Placement {
  x: number;
  y: number;
  rotate: number;
}

/**
 * Where pdf-lib should be told to start drawing a block of the given size, so
 * that it lands on `anchor` and, if tilted, stays centred where it was placed.
 *
 * The returned point is the block's own origin — the text baseline start, or an
 * image's lower-left — expressed in PDF user space, plus the rotation that puts
 * the block upright relative to the page as displayed.
 */
function place(
  page: PDFPage,
  content: { width: number; height: number },
  anchor: Anchor,
  margin: number,
  angle: number
): Placement {
  const box = pageBoxOf(page);
  const visual = visualSize(box);
  const block = anchorBlock(visual, content, anchor, margin);
  const centre = { x: block.x + content.width / 2, y: block.y + content.height / 2 };
  const origin = originForRotatedCenter(centre, content, angle);
  const point = visualUpToPdfPoint(box, origin.x, origin.y);

  return { x: point.x, y: point.y, rotate: uprightTextRotation(box.rotation) + angle };
}

/**
 * The ink height of a line of text above its baseline.
 *
 * Descenders dip below this, so a block sits a hair lower than its box suggests
 * — invisible against any sane margin, and the alternative (counting the
 * descender) would push text with no descenders visibly off its margin.
 */
function inkHeight(font: PDFFont, size: number): number {
  return font.heightAtSize(size, { descender: false });
}

export interface TextStamp {
  text: string;
  font: FontChoice;
  size: number;
  color: Rgb;
  /** 0 is invisible, 1 is solid. */
  opacity: number;
  /** Tilt in degrees, counter-clockwise as the reader sees it. */
  angle: number;
  anchor: Anchor;
  margin: number;
}

/**
 * Draws one line of text on each of `pages`.
 *
 * Takes the pages themselves rather than their numbers. A caller that already
 * holds the handles — Studio does — would otherwise have to turn them into
 * indices for this function to turn them back, and pdf-lib's page list is
 * cached in a way that makes that round trip depend on when the cache was last
 * refreshed. Handles do not go stale.
 */
export async function stampTextOn(
  document: PDFDocument,
  pages: readonly PDFPage[],
  stamp: TextStamp
): Promise<void> {
  // A watermark is a phrase, and the input that feeds this is single-line; a
  // stray newline would silently break the width the placement is built on.
  const text = stamp.text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (text === '') return;

  const font = await document.embedFont(standardFontFor(stamp.font));
  const unsupported = firstUnsupportedCharacter(text, font);
  if (unsupported !== null) throw new UnsupportedCharacterError(unsupported);

  const content = {
    width: font.widthOfTextAtSize(text, stamp.size),
    height: inkHeight(font, stamp.size),
  };

  for (const page of pages) {
    const { x, y, rotate } = place(page, content, stamp.anchor, stamp.margin, stamp.angle);
    page.drawText(text, {
      x,
      y,
      size: stamp.size,
      font,
      color: rgb(stamp.color.r, stamp.color.g, stamp.color.b),
      opacity: stamp.opacity,
      rotate: degrees(rotate),
    });
  }
}

/** The same, addressed by 1-based page number, for the standalone tools. */
export async function stampText(
  document: PDFDocument,
  pageNumbers: readonly number[],
  stamp: TextStamp
): Promise<void> {
  await stampTextOn(document, pagesByNumber(document, pageNumbers), stamp);
}

export interface ImageStamp {
  bytes: Uint8Array;
  opacity: number;
  angle: number;
  anchor: Anchor;
  margin: number;
  /** Width as a fraction of the page's visible width, between 0 and 1. */
  widthFraction: number;
}

export async function stampImage(
  document: PDFDocument,
  pageNumbers: readonly number[],
  stamp: ImageStamp
): Promise<void> {
  const kind = imageKind(stamp.bytes);
  if (kind === null) throw new Error('The watermark image must be a PNG or a JPEG.');

  // Embedded once and reused: a logo on 200 pages must not be 200 copies.
  const image: PDFImage =
    kind === 'png' ? await document.embedPng(stamp.bytes) : await document.embedJpg(stamp.bytes);

  const pages = document.getPages();
  const aspect = image.height / image.width;

  for (const pageNumber of pageNumbers) {
    const page = pages[pageNumber - 1];
    if (!page) continue;

    // Sized against the page it lands on, so a mixed-size document keeps the
    // stamp proportional rather than huge on the small pages.
    const visual = visualSize(pageBoxOf(page));
    const width = visual.width * stamp.widthFraction;
    const content = { width, height: width * aspect };
    const { x, y, rotate } = place(page, content, stamp.anchor, stamp.margin, stamp.angle);

    page.drawImage(image, {
      x,
      y,
      width: content.width,
      height: content.height,
      opacity: stamp.opacity,
      rotate: degrees(rotate),
    });
  }
}

export interface NumberStamp {
  font: FontChoice;
  size: number;
  color: Rgb;
  anchor: Anchor;
  margin: number;
  /** The number printed on the first stamped page. */
  startAt: number;
  /** `plain` prints 3; `ofTotal` prints 3 de 40. */
  format: 'plain' | 'ofTotal';
  /** The word between the two numbers — "de" or "of", from the dictionary. */
  ofWord: string;
}

/**
 * The label for the `index`-th stamped page (0-based).
 *
 * `ofTotal` counts the pages actually being numbered, not the pages in the
 * document: numbering ten pages of a forty-page file starting at 1 reads
 * "1 de 10" through "10 de 10", which is the only reading that stays true at
 * both ends.
 */
export function pageNumberText(stamp: NumberStamp, index: number, stampedCount: number): string {
  const value = stamp.startAt + index;
  if (stamp.format === 'plain') return String(value);
  return `${value} ${stamp.ofWord} ${stamp.startAt + stampedCount - 1}`;
}

export interface StampNumbersOptions {
  /**
   * How many pages the finished run covers, when that differs from
   * `pageNumbers.length`.
   *
   * The preview stamps a single extracted page, and without this the "3 de 40"
   * format would render "1 de 1" there — a preview that disagrees with the file
   * it is previewing, which is worse than no preview.
   */
  stampedCount?: number;
  /** The position of the first entry of `pageNumbers` within the whole run. */
  startIndex?: number;
}

/** Numbers the pages given, in the order given. See `stampTextOn` for why. */
export async function stampPageNumbersOn(
  document: PDFDocument,
  pages: readonly PDFPage[],
  stamp: NumberStamp,
  { stampedCount, startIndex = 0 }: StampNumbersOptions = {}
): Promise<void> {
  const total = stampedCount ?? pages.length;
  const font = await document.embedFont(standardFontFor(stamp.font));
  const height = inkHeight(font, stamp.size);

  const unsupported = firstUnsupportedCharacter(stamp.ofWord, font);
  if (unsupported !== null) throw new UnsupportedCharacterError(unsupported);

  for (const [index, page] of pages.entries()) {
    const label = pageNumberText(stamp, startIndex + index, total);
    // Re-measured per page: 9 and 10 are different widths, and a right-aligned
    // number that ignored that would drift down the page.
    const content = { width: font.widthOfTextAtSize(label, stamp.size), height };
    const { x, y, rotate } = place(page, content, stamp.anchor, stamp.margin, 0);

    page.drawText(label, {
      x,
      y,
      size: stamp.size,
      font,
      color: rgb(stamp.color.r, stamp.color.g, stamp.color.b),
      rotate: degrees(rotate),
    });
  }
}

/** The same, addressed by 1-based page number, for the standalone tool. */
export async function stampPageNumbers(
  document: PDFDocument,
  pageNumbers: readonly number[],
  stamp: NumberStamp,
  options: StampNumbersOptions = {}
): Promise<void> {
  await stampPageNumbersOn(document, pagesByNumber(document, pageNumbers), stamp, {
    stampedCount: options.stampedCount ?? pageNumbers.length,
    startIndex: options.startIndex,
  });
}
