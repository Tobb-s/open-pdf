import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  type PDFFont,
} from 'pdf-lib';
import type { PDFPageProxy } from 'pdfjs-dist';
import { standardFontFor, type FontChoice } from '@/lib/stamp';
import type { EmbeddedTextFont, TextFont } from '@/lib/studio/script';

/** What Studio could identify for one text run in the opened document. */
export interface DetectedPdfFont {
  id: string;
  name: string;
  /** Present only when the original PDF exposed a reusable font program. */
  bytes: Uint8Array | null;
}

export interface EmbeddedPdfFontProgram {
  name: string;
  bytes: Uint8Array;
}

type PdfJsFontObject = {
  name?: unknown;
  fallbackName?: unknown;
  data?: unknown;
};

const MAX_EMBEDDED_FONT_BYTES = 8 * 1024 * 1024;

const displayName = (value: unknown, fallback: string): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  // A six-character prefix denotes a PDF subset, not the family the reader knows.
  const withoutSubset = raw.replace(/^[A-Z]{6}\+/, '');
  return withoutSubset || fallback;
};

const fontDescriptorOf = (font: PDFDict): PDFDict | undefined => {
  const direct = font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
  if (direct) return direct;
  const descendants = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
  return descendants?.lookupMaybe(0, PDFDict)?.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
};

const baseNameOf = (font: PDFDict): string | null => {
  const direct = font.lookupMaybe(PDFName.of('BaseFont'), PDFName);
  if (direct) return displayName(direct.decodeText(), '');
  const descendants = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
  const descendant = descendants?.lookupMaybe(0, PDFDict);
  const base = descendant?.lookupMaybe(PDFName.of('BaseFont'), PDFName);
  return base ? displayName(base.decodeText(), '') : null;
};

/**
 * Reads original FontFile streams, before PDF.js transforms them for rendering.
 * A transformed font can lose its original Unicode map; the raw program is the
 * only reliable source for reuse.
 */
export async function extractEmbeddedPdfFonts(source: Uint8Array): Promise<readonly EmbeddedPdfFontProgram[]> {
  const document = await PDFDocument.load(source, { ignoreEncryption: true });
  const extracted = new Map<string, EmbeddedPdfFontProgram>();

  for (const page of document.getPages()) {
    const resources = page.node.Resources();
    const fonts = resources?.lookupMaybe(PDFName.Font, PDFDict);
    if (!fonts) continue;

    for (const [, entry] of fonts.entries()) {
      const font = page.node.context.lookupMaybe(entry, PDFDict);
      if (!font) continue;
      const name = baseNameOf(font);
      const descriptor = fontDescriptorOf(font);
      const stream = descriptor?.lookup(PDFName.of('FontFile2')) as PDFRawStream | undefined
        ?? descriptor?.lookup(PDFName.of('FontFile3')) as PDFRawStream | undefined
        ?? descriptor?.lookup(PDFName.of('FontFile')) as PDFRawStream | undefined;
      if (!name || !stream || extracted.has(name)) continue;

      try {
        const bytes = decodePDFRawStream(stream).decode();
        if (bytes.byteLength > 0 && bytes.byteLength <= MAX_EMBEDDED_FONT_BYTES) {
          extracted.set(name, { name, bytes: bytes.slice() });
        }
      } catch {
        // Unsupported stream filters and protected programs remain detectable,
        // but are never offered as reusable assets.
      }
    }
  }
  return [...extracted.values()];
}

/** Reads the translated font objects PDF.js already loaded to render this page. */
export function detectPdfFonts(
  page: PDFPageProxy,
  items: readonly unknown[],
  embeddedPrograms: readonly EmbeddedPdfFontProgram[] = []
): ReadonlyMap<string, DetectedPdfFont> {
  const detected = new Map<string, DetectedPdfFont>();
  for (const item of items) {
    const id = typeof (item as { fontName?: unknown }).fontName === 'string'
      ? (item as { fontName: string }).fontName
      : '';
    if (!id || detected.has(id)) continue;

    try {
      const source = page.commonObjs.get(id) as PdfJsFontObject;
      const name = displayName(source?.name ?? source?.fallbackName, id);
      const original = embeddedPrograms.find((program) => program.name === name);
      const data = original?.bytes ?? (source?.data instanceof Uint8Array && source.data.byteLength <= MAX_EMBEDDED_FONT_BYTES
        ? source.data.slice()
        : null);
      detected.set(id, {
        id,
        name,
        bytes: data,
      });
    } catch {
      // The font may be a system substitution or still be resolving. Its text
      // remains selectable; it simply cannot be offered for reuse.
      detected.set(id, { id, name: id, bytes: null });
    }
  }
  return detected;
}

export function isEmbeddedTextFont(font: TextFont): font is EmbeddedTextFont {
  return 'kind' in font && font.kind === 'embedded';
}

export function embeddedTextFont(
  asset: string,
  source: DetectedPdfFont,
  fallback: FontChoice
): EmbeddedTextFont | null {
  if (!source.bytes) return null;
  return { kind: 'embedded', asset, name: source.name, fallback };
}

export function textFontCacheKey(font: TextFont): string {
  if (isEmbeddedTextFont(font)) return `embedded:${font.asset}`;
  return `standard:${standardFontFor(font)}`;
}

async function fontkitFor(document: PDFDocument): Promise<void> {
  const fontkitModule = await import('@pdf-lib/fontkit');
  const fontkit = (fontkitModule as unknown as {
    default: Parameters<PDFDocument['registerFontkit']>[0];
  }).default;
  document.registerFontkit(fontkit);
}

/** Embeds either the selected source font or Studio's established standard fallback. */
export async function embedTextFont(
  document: PDFDocument,
  font: TextFont,
  assets: ReadonlyMap<string, Uint8Array>
): Promise<PDFFont> {
  if (!isEmbeddedTextFont(font)) return document.embedFont(standardFontFor(font));

  const bytes = assets.get(font.asset);
  if (!bytes) {
    throw new Error(`The embedded font “${font.name}” is no longer available in this Studio session.`);
  }
  await fontkitFor(document);
  return document.embedFont(bytes, { subset: true });
}

/** Proves an embedded font can encode the requested text before Studio creates an edit. */
export async function testEmbeddedFont(bytes: Uint8Array, text: string): Promise<PDFFont> {
  const document = await PDFDocument.create();
  const asset = 'probe';
  return embedTextFont(
    document,
    { kind: 'embedded', asset, name: 'source font', fallback: { family: 'helvetica', bold: false, italic: false } },
    new Map([[asset, bytes]])
  ).then((font) => {
    const supported = new Set(font.getCharacterSet());
    const missing = [...new Set([...text].map((character) => character.codePointAt(0)!))]
      .find((codePoint) => !supported.has(codePoint));
    if (missing !== undefined) {
      throw new Error(`The recovered font does not include the character “${String.fromCodePoint(missing)}”.`);
    }
    font.encodeText(text);
    return font;
  });
}
