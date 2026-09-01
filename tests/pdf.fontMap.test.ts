import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { parseOperations, type Operand } from '@/lib/pdf/contentStream';
import { readPageFonts, readToUnicodeCMap, glyphNameToUnicode } from '@/lib/pdf/fontMap';

const bytesOf = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff);

describe('reading a ToUnicode map', () => {
  it('reads single character mappings', () => {
    const { toUnicode } = readToUnicodeCMap(
      bytesOf('2 beginbfchar\n<01> <0041>\n<02> <00F1>\nendbfchar')
    );
    expect(toUnicode.get(1)).toBe('A');
    expect(toUnicode.get(2)).toBe('ñ');
  });

  it('reads a range that counts upward from one character', () => {
    const { toUnicode } = readToUnicodeCMap(bytesOf('1 beginbfrange\n<10> <13> <0061>\nendbfrange'));
    expect([0x10, 0x11, 0x12, 0x13].map((code) => toUnicode.get(code))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(toUnicode.get(0x14)).toBeUndefined();
  });

  it('reads a range that lists its destinations', () => {
    const { toUnicode } = readToUnicodeCMap(
      bytesOf('1 beginbfrange\n<20> <22> [<0058> <0059> <005A>]\nendbfrange')
    );
    expect([0x20, 0x21, 0x22].map((code) => toUnicode.get(code))).toEqual(['X', 'Y', 'Z']);
  });

  it('keeps a multi-character destination whole, for a ligature', () => {
    const { toUnicode } = readToUnicodeCMap(bytesOf('1 beginbfchar\n<05> <00660066>\nendbfchar'));
    expect(toUnicode.get(5)).toBe('ff');
  });

  it('takes the code width from the codespace range', () => {
    const reading = readToUnicodeCMap(
      bytesOf('1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange')
    );
    expect(reading.codeBytes).toBe(2);
  });

  it('refuses a range so large it could only be malformed', () => {
    const { toUnicode } = readToUnicodeCMap(
      bytesOf('1 beginbfrange\n<000000> <FFFFFF> <0041>\nendbfrange')
    );
    expect(toUnicode.size).toBe(0);
  });
});

describe('glyph names', () => {
  it('resolves the forms that carry their answer', () => {
    expect(glyphNameToUnicode('uni00F1')).toBe('ñ');
    expect(glyphNameToUnicode('u00E9')).toBe('é');
    expect(glyphNameToUnicode('A')).toBe('A');
    expect(glyphNameToUnicode('space')).toBe(' ');
    expect(glyphNameToUnicode('ntilde')).toBe('ñ');
  });

  it('returns nothing rather than a guess for a name it does not know', () => {
    // Answering wrongly here would draw the wrong glyph in a replacement.
    expect(glyphNameToUnicode('afii10017')).toBeNull();
    expect(glyphNameToUnicode('g4721')).toBeNull();
  });
});

describe('a document written by pdf-lib: standard fonts, WinAnsi, no ToUnicode', () => {
  const build = async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([300, 200]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText('Hola', { x: 20, y: 100, size: 14, font });
    const bytes = await document.save();
    const reopened = await PDFDocument.load(bytes);
    return readPageFonts(reopened.getPages()[0].node.Resources());
  };

  it('falls back to the encoding table when there is no ToUnicode', async () => {
    const fonts = await build();
    const font = [...fonts.values()][0];
    expect(font.source).toBe('encoding');
    expect(font.kind).toBe('simple');
    expect(font.subset).toBe(false);
    expect(font.codeBytes).toBe(1);
    expect(font.toUnicode.get(0x41)).toBe('A');
    expect(font.toUnicode.get(0xf1)).toBe('ñ');
  });

  it('knows the widths of a standard font, which the file does not carry', async () => {
    const fonts = await build();
    const font = [...fonts.values()][0];
    // Helvetica's own metrics: A is 667 thousandths, i is 222, space is 278.
    expect(font.widthOf(0x41)).toBe(667);
    expect(font.widthOf(0x69)).toBe(222);
    expect(font.widthOf(0x20)).toBe(278);
  });

  it('can answer which code to emit for a character', async () => {
    const fonts = await build();
    const font = [...fonts.values()][0];
    expect(font.fromUnicode.get('Z')).toBe(0x5a);
    expect(font.fromUnicode.get('ñ')).toBe(0xf1);
  });
});

/**
 * The reading that decides whether any of this is real.
 *
 * A LaTeX document is the ordinary hard case: five subsetted Type1 faces, no
 * `/Encoding`, a `/ToUnicode` for each, accented letters written as octal
 * escapes, and words shattered across a `TJ` array by kerning. If the codes in
 * that stream decode back into the sentence a person would read, then the map
 * is right; if they do not, everything built on top of it is guesswork.
 */
describe('a real LaTeX document', () => {
  const REAL = 'C:/Users/tobia/.gemini/antigravity/scratch/quant_finance_paper/documento_quant.pdf';

  const firstPage = async () => {
    const document = await PDFDocument.load(new Uint8Array(readFileSync(REAL)), {
      ignoreEncryption: true,
    });
    const page = document.getPages()[0];
    const contents = page.node.Contents();
    const streams: PDFRawStream[] = [];
    if (contents instanceof PDFArray) {
      for (let index = 0; index < contents.size(); index += 1) {
        const stream = page.node.context.lookup(contents.get(index));
        if (stream instanceof PDFRawStream) streams.push(stream);
      }
    } else if (contents instanceof PDFRawStream) {
      streams.push(contents);
    }
    return {
      fonts: readPageFonts(page.node.Resources()),
      stream: decodePDFRawStream(streams[0]).decode(),
    };
  };

  it.skipIf(!existsSync(REAL))('reads every font it uses through ToUnicode', async () => {
    const { fonts } = await firstPage();
    expect(fonts.size).toBeGreaterThanOrEqual(5);
    for (const font of fonts.values()) {
      expect(font.kind).toBe('simple');
      expect(font.subset).toBe(true);
      expect(font.source).toBe('toUnicode');
      expect(font.toUnicode.size).toBeGreaterThan(20);
    }
  });

  it.skipIf(!existsSync(REAL))('decodes the codes back into the sentence on the page', async () => {
    const { fonts, stream } = await firstPage();

    // Walk the operators, tracking the selected font, and decode every string
    // shown. This is the whole find-a-word problem in miniature.
    let current = '';
    const lines: string[] = [];
    for (const operation of parseOperations(stream)) {
      if (operation.operator === 'Tf') {
        const name = operation.operands.find((operand) => operand.kind === 'name');
        if (name?.kind === 'name') current = name.name;
        continue;
      }
      if (operation.operator !== 'Tj' && operation.operator !== 'TJ') continue;
      const font = fonts.get(current);
      if (!font) continue;

      const decode = (operand: Operand): string => {
        if (operand.kind !== 'string') return '';
        let out = '';
        for (let at = 0; at + font.codeBytes <= operand.bytes.length; at += font.codeBytes) {
          let code = 0;
          for (let byte = 0; byte < font.codeBytes; byte += 1) {
            code = code * 256 + operand.bytes[at + byte];
          }
          out += font.toUnicode.get(code) ?? '';
        }
        return out;
      };

      const first = operation.operands[0];
      if (operation.operator === 'Tj') lines.push(decode(first));
      else if (first?.kind === 'array') lines.push(first.items.map(decode).join(''));
    }

    const all = lines.join(' ');
    // The title of that document, as a person reads it. The kerning splits it
    // into (T)(ratado) and (Cuan)(titativ)(as:) in the file.
    expect(all).toContain('Tratado');
    expect(all).toContain('Cuantitativas:');
    expect(all).toContain('Asimetr');
  });

  it.skipIf(!existsSync(REAL))('shows that an accented letter is not one character', async () => {
    // The finding that shapes everything above this line, frozen so it cannot
    // quietly stop being true.
    //
    // TeX does not draw «í». Its fonts have no such glyph: the word
    // «Asimetrías» is written as A-s-i-m-e-t-r, then a loose acute accent, then
    // a DOTLESS i, then a-s — four separate glyphs where a reader sees one
    // letter, with the accent slid over the i by a kerning number. So a reader
    // searching for «Asimetrías» is searching for a string that is not in the
    // file, and a replacement that needs an «í» is asking for a glyph the font
    // does not contain.
    //
    // Both are solvable and neither is solvable by pretending. Matching has to
    // compose the pair before comparing; writing has to take the pair apart
    // again and borrow the document's own kerning to place the accent.
    const { fonts } = await firstPage();
    const font = fonts.get('F45')!;

    expect(font.toUnicode.get(0x10)).toBe('ı'); // dotless i, U+0131
    expect(font.toUnicode.get(0x13)).toBe('´'); // acute accent on its own

    // The composed letters simply are not there.
    expect(font.fromUnicode.has('í')).toBe(false);
    expect(font.fromUnicode.has('á')).toBe(false);
    expect(font.fromUnicode.has('ñ')).toBe(false);
    // While the pieces they are built from are.
    expect(font.fromUnicode.has('ı')).toBe(true);
    expect(font.fromUnicode.has('´')).toBe(true);
    expect(font.fromUnicode.has('˜')).toBe(true); // the tilde, for ñ
  });

  it.skipIf(!existsSync(REAL))('carries widths for the codes it uses', async () => {
    const { fonts } = await firstPage();
    const font = [...fonts.values()].find((candidate) => candidate.toUnicode.size > 40)!;
    const codeForA = font.fromUnicode.get('a');
    expect(codeForA).toBeDefined();
    expect(font.widthOf(codeForA!)).toBeGreaterThan(0);
  });
});
