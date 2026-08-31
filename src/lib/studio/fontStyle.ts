import { PDFDict, PDFName, PDFNumber, PDFString, type PDFDocument, type PDFPage } from 'pdf-lib';
import type { FontChoice } from '@/lib/studio/script';

/**
 * Which fonts a page actually uses, and in what SHAPE.
 *
 * This is the companion of `fonts.ts`, not a rival: that one recovers the
 * embedded font PROGRAM so new text can be set in the document's own face, and
 * this one reads the weight and the slant, which the program does not carry in
 * any form a caller can ask for. When the program cannot be reused — a subset
 * missing a glyph, a stream this cannot decode — the standard face that stands
 * in for it should still come out bold if the original was bold, and that is
 * what this decides.
 *
 * A PDF does not say "bold" anywhere. It says a font is called
 * `KLMNOP+TimesNewRomanPS-BoldItalicMT`, that its descriptor has flag 19 set,
 * that its `/ItalicAngle` is -15 and its `/StemV` is 165. Weight and slant have
 * to be read out of those, and every producer writes them differently: some set
 * the ForceBold flag, some only a `/FontWeight`, some neither and only put the
 * word in the name. So all of the evidence is read, and any of it is enough.
 *
 * This exists so the editor can say what is on the page — and so text added to
 * it can be given the same shape rather than always arriving in plain
 * Helvetica.
 */

export type FontFamily = FontChoice['family'];

export interface DetectedFont {
  /** The name as the document writes it, with any subset prefix removed. */
  name: string;
  bold: boolean;
  italic: boolean;
  /** True when the descriptor says serif, which decides Times over Helvetica. */
  serif: boolean;
  /** True for a typewriter font, which decides Courier. */
  monospace: boolean;
  /** The closest of the three families the editor can actually draw with. */
  family: FontFamily;
}

/* Flags in a /FontDescriptor, by their bit position in the specification. */
const FLAG_FIXED_PITCH = 1 << 0;
const FLAG_SERIF = 1 << 1;
const FLAG_ITALIC = 1 << 6;
const FLAG_FORCE_BOLD = 1 << 18;

/** A weight at or above this is bold in every convention that uses numbers. */
const BOLD_WEIGHT = 600;

/**
 * Stem width above which a font is being drawn heavy.
 *
 * `/StemV` is the thickness of a vertical stroke in thousandths of an em. A
 * regular face sits near 80 and a bold one near 140; 120 is the usual dividing
 * line and it is only ever consulted when nothing more direct is available.
 */
const BOLD_STEM = 120;

/**
 * Strips the subset tag a producer puts in front of an embedded font's name.
 *
 * `KLMNOP+Arial-BoldMT` is Arial-BoldMT, subset to the glyphs the document
 * happens to use. The tag is always six capitals and a plus.
 */
export function baseFontName(raw: string): string {
  const name = raw.replace(/^\/+/, '');
  return /^[A-Z]{6}\+/.test(name) ? name.slice(7) : name;
}

/**
 * What the name alone says, for producers that record nothing else.
 *
 * The rule is that the word must not be followed by a lowercase letter. That
 * one condition separates the two cases that matter: `Arial-BoldMT` and
 * `Helvetica-BoldOblique` are bold — the foundry suffix and the next style word
 * both start with a capital — while `Bolder` and `Boldoni` are not, and a
 * simple substring search calls all four of them bold. Nothing is required
 * BEFORE the word, because `SemiBold` and `ExtraBold` are real names.
 *
 * It errs towards saying nothing: `Boldface` is rejected too. That is the safe
 * direction — a descriptor usually settles it, and claiming a regular face is
 * bold is the worse mistake.
 */
function styleFromName(name: string): { bold: boolean; italic: boolean } {
  const followed = (needle: string) => {
    // The search is case-insensitive; the test on the NEXT character must not
    // be. Writing it as one `/bold(?![a-z])/i` looks right and is not: the `i`
    // flag applies to the lookahead too, so `[a-z]` matches the `M` of
    // `Arial-BoldMT` and every foundry suffix reads as a longer word.
    const finder = new RegExp(needle, 'gi');
    for (let match = finder.exec(name); match !== null; match = finder.exec(name)) {
      const next = name[match.index + match[0].length];
      if (next === undefined || !/[a-z]/.test(next)) return true;
    }
    return false;
  };
  const has = (...needles: string[]) => needles.some(followed);
  return {
    bold: has('bold', 'black', 'heavy'),
    italic: has('italic', 'oblique'),
  };
}

function numberFrom(dict: PDFDict, key: string): number | null {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : null;
}

/**
 * Reads one font dictionary.
 *
 * A Type 0 (composite) font keeps its descriptor one level down, in the
 * descendant that actually holds the glyphs, so that is followed.
 */
export function describeFont(document: PDFDocument, dict: PDFDict): DetectedFont | null {
  const raw = dict.get(PDFName.of('BaseFont'));
  const name = baseFontName(
    raw instanceof PDFString ? raw.asString() : raw ? String(raw) : ''
  );
  if (name === '') return null;

  let descriptor = document.context.lookupMaybe(
    dict.get(PDFName.of('FontDescriptor')),
    PDFDict
  );

  if (!descriptor) {
    // Type 0: the descriptor belongs to the descendant font.
    const descendants = document.context.lookup(dict.get(PDFName.of('DescendantFonts')));
    const first =
      descendants && 'get' in descendants && typeof descendants.get === 'function'
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (descendants as any).get(0)
        : undefined;
    const descendant = document.context.lookupMaybe(first, PDFDict);
    if (descendant) {
      descriptor = document.context.lookupMaybe(
        descendant.get(PDFName.of('FontDescriptor')),
        PDFDict
      );
    }
  }

  const fromName = styleFromName(name);
  let bold = fromName.bold;
  let italic = fromName.italic;
  let serif = /times|serif|roman|georgia|garamond|book|minion|cambria/i.test(name);
  let monospace = /courier|mono|consol/i.test(name);

  if (descriptor) {
    const flags = numberFrom(descriptor, 'Flags') ?? 0;
    if ((flags & FLAG_FORCE_BOLD) !== 0) bold = true;
    if ((flags & FLAG_ITALIC) !== 0) italic = true;
    if ((flags & FLAG_SERIF) !== 0) serif = true;
    if ((flags & FLAG_FIXED_PITCH) !== 0) monospace = true;

    const weight = numberFrom(descriptor, 'FontWeight');
    if (weight !== null && weight >= BOLD_WEIGHT) bold = true;

    const angle = numberFrom(descriptor, 'ItalicAngle');
    if (angle !== null && angle !== 0) italic = true;

    // Only consulted when nothing said so outright: it is a measurement, not a
    // declaration, and a heavy-looking regular face should not be called bold
    // over a producer that took the trouble to say otherwise.
    if (!bold) {
      const stem = numberFrom(descriptor, 'StemV');
      if (stem !== null && stem >= BOLD_STEM) bold = true;
    }
  }

  const family: FontFamily = monospace ? 'courier' : serif ? 'times' : 'helvetica';
  return { name, bold, italic, serif, monospace, family };
}

/**
 * Every font a page can draw with, deduplicated by name and shape.
 *
 * `/Resources` is inheritable, so a page that declares none uses its parent's;
 * `lookup` on the page node follows that chain.
 */
export function fontsOnPage(document: PDFDocument, page: PDFPage): DetectedFont[] {
  const found = new Map<string, DetectedFont>();
  try {
    const resources = document.context.lookupMaybe(page.node.Resources(), PDFDict);
    const fonts = resources
      ? document.context.lookupMaybe(resources.get(PDFName.of('Font')), PDFDict)
      : undefined;
    if (!fonts) return [];

    for (const [, value] of fonts.entries()) {
      const dict = document.context.lookupMaybe(value, PDFDict);
      if (!dict) continue;
      const described = describeFont(document, dict);
      if (!described) continue;
      const key = `${described.name}|${described.bold}|${described.italic}`;
      if (!found.has(key)) found.set(key, described);
    }
  } catch {
    // A resources dictionary this cannot walk tells the reader nothing, which
    // is what an empty list says.
  }
  return [...found.values()];
}

/** The shape the editor's own text tool would need to match this font. */
export function choiceFor(font: DetectedFont): FontChoice {
  return { family: font.family, bold: font.bold, italic: font.italic };
}

/** How a detected font reads in a list: «Arial-BoldMT (negrita, cursiva)». */
export function describeStyle(
  font: DetectedFont,
  words: { bold: string; italic: string; regular: string }
): string {
  const parts: string[] = [];
  if (font.bold) parts.push(words.bold);
  if (font.italic) parts.push(words.italic);
  return parts.length > 0 ? parts.join(', ') : words.regular;
}

/**
 * Every font in the document, by the name `detectPdfFonts` reports.
 *
 * The two sides of Studio's font handling meet here. `fonts.ts` identifies a
 * run by the name pdf.js gives it, with the subset prefix stripped; this walks
 * the pages with pdf-lib and reads the descriptor. Keying on the same stripped
 * name is what lets a recovered font program be paired with the weight and
 * slant it was drawn at.
 */
export function styleByName(document: PDFDocument): Map<string, DetectedFont> {
  const found = new Map<string, DetectedFont>();
  for (const page of document.getPages()) {
    for (const font of fontsOnPage(document, page)) {
      if (!found.has(font.name)) found.set(font.name, font);
    }
  }
  return found;
}

/**
 * The standard face that should stand in for a font, in its own shape.
 *
 * Used wherever the embedded program cannot be reused. Plain Helvetica was the
 * answer before, whatever the original looked like, so replacing a line of bold
 * serif produced a line of light sans and the page no longer matched itself.
 */
export function fallbackFor(
  styles: ReadonlyMap<string, DetectedFont>,
  name: string | undefined
): FontChoice {
  const found = name === undefined ? undefined : styles.get(baseFontName(name));
  return found ? choiceFor(found) : { family: 'helvetica', bold: false, italic: false };
}
