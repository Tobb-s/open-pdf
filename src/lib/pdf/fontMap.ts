import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFStream,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';
import { Encodings, Font } from '@pdf-lib/standard-fonts';
import { parseOperations, type Operand } from '@/lib/pdf/contentStream';

/**
 * What a font resource says about the codes that appear in a content stream.
 *
 * A show-text operator holds character codes, and a code means nothing on its
 * own. `<41>` is the letter A in one font, a comma in the next, and half of a
 * two-byte identifier in a third. To find a word in a page — and, harder, to
 * write a different one — three questions have to be answered about every font
 * the page uses: how many bytes make one code, what character each code stands
 * for, and how wide each code is.
 *
 * The third question is the one that decides whether a replacement can be
 * called exact. Writing a word is easy; writing it so that everything after it
 * on the line stays where it was requires knowing what the old word measured.
 *
 * There is one piece of luck worth naming, because the whole design rests on
 * it. A subsetted font — and almost every embedded font in a real document is
 * subsetted — contains only the glyphs the document actually used. Nothing in
 * the font dictionary announces which those are. But a `/ToUnicode` map is
 * generated from the glyphs that are present, so inverting it gives exactly the
 * set of characters this font can still draw. That is why «can this font write
 * the letter ñ» is answerable at all, and answerable without parsing a single
 * byte of the font program.
 */

export type FontKind = 'simple' | 'composite' | 'unsupported';

export interface FontMap {
  /** The resource name it is reached by, such as `F44`. */
  resource: string;
  kind: FontKind;
  /** `Type1`, `TrueType`, `Type0`, `Type3`… as the dictionary declares it. */
  subtype: string;
  /** The base font name with any subset prefix removed. */
  baseFont: string;
  /** True when the name carried a six-letter subset prefix such as `MLAXTP+`. */
  subset: boolean;
  /** How many bytes make up one character code. One, or two for Identity CMaps. */
  codeBytes: number;
  /** Where the code-to-character knowledge came from, which is how far it can be trusted. */
  source: 'toUnicode' | 'encoding' | 'none';
  /** Character for each code that this font is known to draw. */
  toUnicode: ReadonlyMap<number, string>;
  /** The inverse: the code to emit for a character, when there is one. */
  fromUnicode: ReadonlyMap<string, number>;
  /** Advance width in glyph space (thousandths of the font size). */
  widthOf(code: number): number;
}

const SUBSET_PREFIX = /^[A-Z]{6}\+/;

const nameOf = (dict: PDFDict, key: string): string | null =>
  dict.lookupMaybe(PDFName.of(key), PDFName)?.decodeText() ?? null;

const numberOf = (dict: PDFDict, key: string): number | null =>
  dict.lookupMaybe(PDFName.of(key), PDFNumber)?.asNumber() ?? null;

function streamBytes(value: unknown): Uint8Array | null {
  if (value instanceof PDFRawStream) {
    try {
      return decodePDFRawStream(value).decode();
    } catch {
      return null;
    }
  }
  if (value instanceof PDFStream) {
    try {
      return (value as unknown as { getContents(): Uint8Array }).getContents();
    } catch {
      return null;
    }
  }
  return null;
}

/** Reads a big-endian integer out of a hex string operand's bytes. */
const codeFrom = (bytes: Uint8Array): number =>
  bytes.reduce((total, byte) => total * 256 + byte, 0);

/** A `/ToUnicode` destination is UTF-16BE, and may be several units for a ligature. */
function utf16beText(bytes: Uint8Array): string {
  let out = '';
  for (let at = 0; at + 1 < bytes.length; at += 2) {
    out += String.fromCharCode(bytes[at] * 256 + bytes[at + 1]);
  }
  // An odd trailing byte is malformed; keeping it is better than dropping the
  // whole entry, since a one-byte destination does occur in the wild.
  if (bytes.length === 1) out = String.fromCharCode(bytes[0]);
  return out;
}

interface CMapReading {
  toUnicode: Map<number, string>;
  /** Byte length taken from `begincodespacerange`, when it says. */
  codeBytes: number | null;
}

/**
 * Reads a `/ToUnicode` CMap.
 *
 * A CMap is written in the same postfix syntax as a content stream, so the
 * operator reader already handles it: the operands that pile up before
 * `endbfchar` are exactly the source/destination pairs, and the ones before
 * `endbfrange` are the triples. Reusing it avoids a second parser that would
 * have to make the same decisions about escapes and hex padding, and would
 * eventually make one of them differently.
 */
export function readToUnicodeCMap(bytes: Uint8Array): CMapReading {
  const toUnicode = new Map<number, string>();
  let codeBytes: number | null = null;

  const isString = (operand: Operand | undefined): operand is Extract<Operand, { kind: 'string' }> =>
    operand?.kind === 'string';

  for (const operation of parseOperations(bytes)) {
    if (operation.operator === 'endcodespacerange') {
      const first = operation.operands.find(isString);
      if (first && first.bytes.length > 0) codeBytes = first.bytes.length;
      continue;
    }

    if (operation.operator === 'endbfchar') {
      const operands = operation.operands.filter(isString);
      for (let at = 0; at + 1 < operands.length; at += 2) {
        toUnicode.set(codeFrom(operands[at].bytes), utf16beText(operands[at + 1].bytes));
      }
      continue;
    }

    if (operation.operator === 'endbfrange') {
      // Triples of (low, high, destination), where the destination is either a
      // starting character that increments across the range, or an array with
      // one entry per code.
      const operands = operation.operands;
      for (let at = 0; at + 2 < operands.length; at += 3) {
        const low = operands[at];
        const high = operands[at + 1];
        const destination = operands[at + 2];
        if (!isString(low) || !isString(high)) continue;
        const from = codeFrom(low.bytes);
        const to = codeFrom(high.bytes);
        // A malformed range could otherwise ask for millions of entries.
        if (to < from || to - from > 0xffff) continue;

        if (destination.kind === 'array') {
          destination.items.forEach((item, offset) => {
            if (isString(item)) toUnicode.set(from + offset, utf16beText(item.bytes));
          });
          continue;
        }
        if (!isString(destination)) continue;
        const base = utf16beText(destination.bytes);
        if (base.length === 0) continue;
        const lastUnit = base.charCodeAt(base.length - 1);
        const prefix = base.slice(0, -1);
        for (let code = from; code <= to; code += 1) {
          toUnicode.set(code, prefix + String.fromCharCode(lastUnit + (code - from)));
        }
      }
    }
  }

  return { toUnicode, codeBytes };
}

/** Code to character for the named simple-font encoding, inverted from the standard tables. */
function encodingTable(encodingName: string | null): Map<number, string> {
  const table = new Map<number, string>();
  // WinAnsi is the only one of the three the standard-fonts package ships, and
  // it is what all but a handful of documents use. Standard and MacRoman fall
  // back to it: they agree on every code below 128, which is where the
  // characters a reader is likely to replace actually live. Above 128 they
  // differ, and a wrong answer there is caught later — a replacement is only
  // offered when the character round-trips.
  const encoding = Encodings.WinAnsi;
  for (const codePoint of encoding.supportedCodePoints) {
    const { code } = encoding.encodeUnicodeCodePoint(codePoint);
    if (!table.has(code)) table.set(code, String.fromCodePoint(codePoint));
  }
  if (encodingName === 'MacRomanEncoding' || encodingName === 'StandardEncoding') {
    for (const code of [...table.keys()]) {
      if (code >= 128) table.delete(code);
    }
  }
  return table;
}

/** Applies an `/Encoding` dictionary's `/Differences` array over a base table. */
function applyDifferences(table: Map<number, string>, differences: PDFArray, dict: PDFDict): void {
  let code = 0;
  for (let index = 0; index < differences.size(); index += 1) {
    const entry = dict.context.lookup(differences.get(index));
    if (entry instanceof PDFNumber) {
      code = entry.asNumber();
      continue;
    }
    if (entry instanceof PDFName) {
      const character = glyphNameToUnicode(entry.decodeText());
      if (character) table.set(code, character);
      else table.delete(code);
      code += 1;
    }
  }
}

/**
 * Turns a glyph name into the character it stands for.
 *
 * Only the forms that carry their answer in the name itself: `uni00F1`, `u00F1`,
 * the single letters, and the handful of names that are just an ASCII
 * character. The full Adobe Glyph List is thousands of entries and is not
 * shipped here; a name it cannot resolve means that code is left out of the
 * map, which makes the font look unable to write that character. Erring that
 * way is deliberate — refusing a replacement that would have worked is a
 * disappointment, and making one that draws the wrong glyph is a defect.
 */
export function glyphNameToUnicode(name: string): string | null {
  const uni = /^uni([0-9A-Fa-f]{4,6})$/.exec(name);
  if (uni) return String.fromCodePoint(parseInt(uni[1], 16));
  const u = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (u) return String.fromCodePoint(parseInt(u[1], 16));
  if (name.length === 1) return name;

  const known: Record<string, string> = {
    space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%',
    ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')', asterisk: '*',
    plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/', zero: '0', one: '1',
    two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8',
    nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>',
    question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']',
    asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|',
    braceright: '}', asciitilde: '~', quoteright: '’', quoteleft: '‘',
    quotedblleft: '“', quotedblright: '”', endash: '–', emdash: '—',
    bullet: '•', germandbls: 'ß', ntilde: 'ñ', Ntilde: 'Ñ', ccedilla: 'ç',
    Ccedilla: 'Ç', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', udieresis: 'ü',
    Udieresis: 'Ü', adieresis: 'ä', odieresis: 'ö', agrave: 'à', egrave: 'è',
    exclamdown: '¡', questiondown: '¿', degree: '°', ordfeminine: 'ª', ordmasculine: 'º',
    guillemotleft: '«', guillemotright: '»', section: '§', paragraph: '¶',
  };
  return known[name] ?? null;
}

/** Reads a composite font's `/W` array into a code-to-width lookup. */
function readCidWidths(w: PDFArray | undefined, dict: PDFDict): Map<number, number> {
  const widths = new Map<number, number>();
  if (!w) return widths;
  let index = 0;
  while (index < w.size()) {
    const first = dict.context.lookup(w.get(index));
    if (!(first instanceof PDFNumber)) break;
    const start = first.asNumber();
    const second = dict.context.lookup(w.get(index + 1));

    if (second instanceof PDFArray) {
      // `c [w1 w2 …]`: consecutive codes starting at c.
      for (let offset = 0; offset < second.size(); offset += 1) {
        const value = dict.context.lookup(second.get(offset));
        if (value instanceof PDFNumber) widths.set(start + offset, value.asNumber());
      }
      index += 2;
      continue;
    }
    if (second instanceof PDFNumber) {
      // `cFirst cLast w`: one width for the whole run.
      const last = second.asNumber();
      const third = dict.context.lookup(w.get(index + 2));
      if (third instanceof PDFNumber && last >= start && last - start <= 0xffff) {
        for (let code = start; code <= last; code += 1) widths.set(code, third.asNumber());
      }
      index += 3;
      continue;
    }
    break;
  }
  return widths;
}

/** Builds the reading of one font resource. Never throws; an unreadable font reports as such. */
export function readFontMap(resource: string, dict: PDFDict): FontMap {
  const subtype = nameOf(dict, 'Subtype') ?? '';
  const rawBase = nameOf(dict, 'BaseFont') ?? '';
  const subset = SUBSET_PREFIX.test(rawBase);
  const baseFont = rawBase.replace(SUBSET_PREFIX, '');

  const descendants = dict.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
  const descendant = descendants?.lookupMaybe(0, PDFDict);
  const composite = subtype === 'Type0';

  // --- how many bytes make a code ------------------------------------------
  let codeBytes = composite ? 2 : 1;
  const encodingValue = dict.lookup(PDFName.of('Encoding'));
  const encodingName = encodingValue instanceof PDFName ? encodingValue.decodeText() : null;

  // --- code to character ----------------------------------------------------
  const cmap = readToUnicodeCMap(streamBytes(dict.lookup(PDFName.of('ToUnicode'))) ?? new Uint8Array());
  let toUnicode = cmap.toUnicode;
  let source: FontMap['source'] = toUnicode.size > 0 ? 'toUnicode' : 'none';
  if (composite && cmap.codeBytes) codeBytes = cmap.codeBytes;

  if (source === 'none' && !composite) {
    toUnicode = encodingTable(encodingName);
    if (encodingValue instanceof PDFDict) {
      const base = nameOf(encodingValue, 'BaseEncoding');
      toUnicode = encodingTable(base);
      const differences = encodingValue.lookupMaybe(PDFName.of('Differences'), PDFArray);
      if (differences) applyDifferences(toUnicode, differences, dict);
    }
    source = toUnicode.size > 0 ? 'encoding' : 'none';
  }

  // --- character to code ----------------------------------------------------
  const fromUnicode = new Map<string, number>();
  for (const [code, text] of toUnicode) {
    // Single characters only: a code that stands for a ligature cannot be used
    // to spell one letter, and keeping it would let a replacement emit "ffi"
    // where an "f" was asked for.
    if (text.length !== 1) continue;
    const existing = fromUnicode.get(text);
    if (existing === undefined || code < existing) fromUnicode.set(text, code);
  }

  // --- widths ---------------------------------------------------------------
  const descriptor =
    dict.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict) ??
    descendant?.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
  const missingWidth = descriptor ? numberOf(descriptor, 'MissingWidth') ?? 0 : 0;

  let widthOf: (code: number) => number;
  if (composite) {
    const defaultWidth = descendant ? numberOf(descendant, 'DW') ?? 1000 : 1000;
    const table = readCidWidths(descendant?.lookupMaybe(PDFName.of('W'), PDFArray), dict);
    widthOf = (code) => table.get(code) ?? defaultWidth;
  } else {
    const first = numberOf(dict, 'FirstChar') ?? 0;
    const widths = dict.lookupMaybe(PDFName.of('Widths'), PDFArray);
    const table = new Map<number, number>();
    if (widths) {
      for (let index = 0; index < widths.size(); index += 1) {
        const value = dict.context.lookup(widths.get(index));
        if (value instanceof PDFNumber) table.set(first + index, value.asNumber());
      }
    }
    const standard = table.size === 0 ? standardWidths(baseFont) : null;
    widthOf = (code) => {
      const known = table.get(code);
      if (known !== undefined) return known;
      if (standard) {
        const character = toUnicode.get(code);
        const width = character ? standard.get(character) : undefined;
        if (width !== undefined) return width;
      }
      return missingWidth;
    };
  }

  const kind: FontKind =
    subtype === 'Type3' || subtype === '' ? 'unsupported' : composite ? 'composite' : 'simple';

  return {
    resource,
    kind,
    subtype,
    baseFont,
    subset,
    codeBytes,
    source,
    toUnicode,
    fromUnicode,
    widthOf,
  };
}

/**
 * Metrics for the fourteen fonts a viewer supplies itself.
 *
 * These have no `/Widths` in the file — the specification says a reader already
 * knows them — so without this every standard-font document would measure every
 * glyph as zero and every replacement would report a width change that is not
 * real.
 */
const standardCache = new Map<string, Map<string, number> | null>();

function standardWidths(baseFont: string): Map<string, number> | null {
  if (standardCache.has(baseFont)) return standardCache.get(baseFont) ?? null;

  const names: Record<string, string> = {
    Helvetica: 'Helvetica',
    'Helvetica-Bold': 'Helvetica-Bold',
    'Helvetica-Oblique': 'Helvetica-Oblique',
    'Helvetica-BoldOblique': 'Helvetica-BoldOblique',
    Arial: 'Helvetica',
    'Arial-Bold': 'Helvetica-Bold',
    Courier: 'Courier',
    'Courier-Bold': 'Courier-Bold',
    'Courier-Oblique': 'Courier-Oblique',
    'Courier-BoldOblique': 'Courier-BoldOblique',
    'Times-Roman': 'Times-Roman',
    'Times-Bold': 'Times-Bold',
    'Times-Italic': 'Times-Italic',
    'Times-BoldItalic': 'Times-BoldItalic',
    Symbol: 'Symbol',
    ZapfDingbats: 'ZapfDingbats',
  };
  const resolved = names[baseFont];
  if (!resolved) {
    standardCache.set(baseFont, null);
    return null;
  }

  // Guarded rather than trusted: `Font.load` throws for a name it does not
  // know, and a glyph measured as zero is a worse outcome than a width that is
  // simply unavailable — but neither is worth failing an edit over.
  let table: Map<string, number> | null = null;
  try {
    const font = Font.load(resolved as Parameters<typeof Font.load>[0]);
    table = new Map<string, number>();
    for (const metric of font.CharMetrics) {
      const character = glyphNameToUnicode(metric.N);
      if (character && !table.has(character)) table.set(character, metric.WX);
    }
  } catch {
    table = null;
  }
  standardCache.set(baseFont, table);
  return table;
}

/** Every font a page can reach by name, read once. */
export function readPageFonts(resources: PDFDict | undefined): Map<string, FontMap> {
  const maps = new Map<string, FontMap>();
  const fonts = resources?.lookupMaybe(PDFName.Font, PDFDict);
  if (!fonts) return maps;
  for (const [key, value] of fonts.entries()) {
    const dict = resources!.context.lookupMaybe(value, PDFDict);
    if (!dict) continue;
    const resource = key.decodeText().replace(/^\//, '');
    try {
      maps.set(resource, readFontMap(resource, dict));
    } catch {
      // A font that cannot be read is a font whose text cannot be edited. It is
      // recorded as unsupported rather than dropped, so the reason a word could
      // not be replaced can be given as «this font», not as «not found».
      maps.set(resource, {
        resource,
        kind: 'unsupported',
        subtype: '',
        baseFont: '',
        subset: false,
        codeBytes: 1,
        source: 'none',
        toUnicode: new Map(),
        fromUnicode: new Map(),
        widthOf: () => 0,
      });
    }
  }
  return maps;
}
