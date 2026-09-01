import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { parseOperations } from '@/lib/pdf/contentStream';
import { readPageFonts } from '@/lib/pdf/fontMap';
import { scanText, UNREADABLE } from '@/lib/pdf/textScan';

const bytesOf = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff);

/** Everything one page of a document needs to be scanned. */
async function scanPage(bytes: Uint8Array, index = 0) {
  const document = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const page = document.getPages()[index];
  const contents = page.node.Contents();
  const streams: PDFRawStream[] = [];
  if (contents instanceof PDFArray) {
    for (let at = 0; at < contents.size(); at += 1) {
      const stream = page.node.context.lookup(contents.get(at));
      if (stream instanceof PDFRawStream) streams.push(stream);
    }
  } else if (contents instanceof PDFRawStream) {
    streams.push(contents);
  }

  const parts = streams.map((stream) => decodePDFRawStream(stream).decode());
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length + 1, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
    joined[at] = 0x0a;
    at += 1;
  }

  return scanText(parseOperations(joined), readPageFonts(page.node.Resources()));
}

/** What pdf.js reads from the same page, as the second opinion. */
async function pdfjsText(bytes: Uint8Array, index = 0): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  const page = await document.getPage(index + 1);
  const content = await page.getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join('');
}

/**
 * A one-page document whose content stream is exactly what was asked for.
 *
 * `newFontDictionary` invents a unique key from the tag it is given, so a
 * stream written against `/F1` would find no font at all; `setFontDictionary`
 * puts it under the name the stream actually uses.
 */
async function pageWithStream(stream: string, face = StandardFonts.Helvetica) {
  const { PDFName } = await import('pdf-lib');
  const document = await PDFDocument.create();
  const page = document.addPage([300, 200]);
  const font = await document.embedFont(face);
  page.node.setFontDictionary(PDFName.of('F1'), font.ref);
  page.node.set(
    PDFName.of('Contents'),
    document.context.register(document.context.flateStream(bytesOf(stream)))
  );
  return document.save();
}

const squashed = (text: string) => text.replace(/\s+/g, '');

describe('walking the pen', () => {
  it('reads a plain line', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([300, 200]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText('Hola Juan', { x: 20, y: 100, size: 14, font });
    const scan = await scanPage(await document.save());
    expect(scan.text).toBe('Hola Juan');
  });

  it('puts a space where the file only has a number', async () => {
    // The case that matters: between «de» and «Finanzas» a LaTeX document has
    // no space glyph at all, only a -375 that moves the pen.
    const stream = 'BT /F1 12 Tf 20 100 Td [(de) -375 (Finanzas)] TJ ET';
    const scan = await scanPage(await pageWithStream(stream));
    expect(scan.text).toBe('de Finanzas');
  });

  it('does not invent a space out of ordinary kerning', async () => {
    const stream = 'BT /F1 12 Tf 20 100 Td [(T) 94 (ratado)] TJ ET';
    const scan = await scanPage(await pageWithStream(stream));
    expect(scan.text).toBe('Tratado');
  });

  it('follows the pen across lines', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([300, 200]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText('primera', { x: 20, y: 150, size: 12, font });
    page.drawText('segunda', { x: 20, y: 120, size: 12, font });
    const scan = await scanPage(await document.save());
    expect(scan.text).toBe('primera\nsegunda');
  });

  it('maps every character back to the glyph that drew it', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([300, 200]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText('abc', { x: 20, y: 100, size: 14, font });
    const scan = await scanPage(await document.save());

    expect(scan.positions).toHaveLength(scan.text.length);
    const at = scan.text.indexOf('b');
    const where = scan.positions[at]!;
    const glyph = scan.runs[where.run].glyphs[where.glyph];
    expect(glyph.text).toBe('b');
    expect(glyph.code).toBe('b'.charCodeAt(0));
  });

  it('measures the advance, so a replacement can be measured against it', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([300, 200]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText('AV', { x: 20, y: 100, size: 10, font });
    const scan = await scanPage(await document.save());
    const [a, v] = scan.runs[0].glyphs;
    // Helvetica: A is 667 thousandths, V is 667. At size 10 that is 6.67 each.
    expect(a.advance).toBeCloseTo(6.67, 2);
    expect(v.x - a.x).toBeCloseTo(6.67, 2);
  });

  it('reports invisible text as invisible', async () => {
    // A scanned page's OCR layer is drawn with render mode 3. Anything acting
    // on text has to be able to tell it apart from what the reader can see.
    const stream = 'BT /F1 12 Tf 3 Tr 20 100 Td (oculto) Tj ET';
    const scan = await scanPage(await pageWithStream(stream));
    expect(scan.runs[0].renderMode).toBe(3);
  });

  it('restores the transform when a save is undone', async () => {
    const stream = [
      'q 2 0 0 2 0 0 cm',
      'BT /F1 10 Tf 10 10 Td (dentro) Tj ET',
      'Q',
      'BT /F1 10 Tf 10 10 Td (fuera) Tj ET',
    ].join('\n');
    const scan = await scanPage(await pageWithStream(stream));
    // The same Td under a doubled transform lands at twice the coordinates.
    expect(scan.runs[0].glyphs[0].x).toBeCloseTo(20, 5);
    expect(scan.runs[1].glyphs[0].x).toBeCloseTo(10, 5);
  });
});

/**
 * The check that cannot be argued with.
 *
 * pdf.js has its own parser, written by other people from the same
 * specification, and it renders these documents for a living. If this walk
 * disagrees with it about which glyphs are on a page, this walk is wrong.
 * Whitespace is removed from both sides before comparing: where a word break
 * goes is a judgement each is entitled to make differently, but a glyph is a
 * glyph.
 */
describe('agreeing with pdf.js', () => {
  const REAL = [
    'C:/Users/tobia/.gemini/antigravity/scratch/quant_finance_paper/documento_quant.pdf',
    'C:/Users/tobia/.gemini/antigravity/scratch/proyecto-transcripcion/.vad-tmp/muestra.pdf',
  ];

  /**
   * The condition under which the two readings can be held to be identical.
   *
   * A page where every code had a `/ToUnicode` entry is a page where the
   * document itself said what it meant, and there is nothing left to interpret:
   * two correct parsers must produce the same glyphs. Where the document did
   * not say — a TeX maths font that never described its summation sign — both
   * are guessing, and demanding they guess alike would be testing that this one
   * copies pdf.js rather than that it reads the file.
   */
  const fullyDescribed = (mine: string) => !mine.includes(UNREADABLE);

  for (const path of REAL) {
    it.skipIf(!existsSync(path))(
      `reads the same glyphs as pdf.js from ${path.split('/').pop()}`,
      async () => {
        const bytes = new Uint8Array(readFileSync(path));
        const document = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = Math.min(document.getPageCount(), 5);

        let compared = 0;
        for (let index = 0; index < pages; index += 1) {
          const mine = squashed((await scanPage(bytes, index)).text);
          const theirs = squashed(await pdfjsText(bytes, index));
          expect(theirs.length).toBeGreaterThan(0);
          if (!fullyDescribed(mine)) continue;
          expect({ page: index, text: mine }).toEqual({ page: index, text: theirs });
          compared += 1;
        }
        // A test that skipped every page would pass while proving nothing.
        expect(compared).toBeGreaterThan(0);
      },
      180000
    );
  }

  it.skipIf(!existsSync(REAL[0]))(
    'refuses to read a summation sign as the letter P, which pdf.js does',
    async () => {
      // Page four of that document carries the VPIN formula, whose Σ comes from
      // a TeX maths font at code 0x50 — the same slot the standard encoding
      // gives to P, and with no ToUnicode entry to say otherwise.
      //
      // This is the whole argument for reading the codes here rather than
      // taking pdf.js's text and trusting it: a replace-all for «P» driven by
      // that reading would find a summation sign and overwrite it. The same
      // page shows the other half of the problem — three absolute-value bars
      // that pdf.js drops without a word, so a reader diffing before and after
      // would see text that was never there go missing.
      const bytes = new Uint8Array(readFileSync(REAL[0]));
      const mine = squashed((await scanPage(bytes, 3)).text);
      const theirs = squashed(await pdfjsText(bytes, 3));

      expect(mine).toContain(`VPIN=${UNREADABLE}N`);
      expect(theirs).toContain('VPIN=PN');
      expect(mine).not.toContain('VPIN=PN');
    },
    180000
  );

  it.skipIf(!existsSync(REAL[0]))(
    'marks what it cannot read instead of leaving a gap in the sentence',
    async () => {
      // The count is not the point; that every one of them is marked is. A
      // glyph read as nothing would let a match run straight through it, and a
      // replacement would then delete a character the reader never saw.
      const bytes = new Uint8Array(readFileSync(REAL[0]));
      const scan = await scanPage(bytes, 3);
      const marked = [...scan.text].filter((character) => character === UNREADABLE).length;
      expect(marked).toBeGreaterThan(0);

      const glyphs = scan.runs.flatMap((run) => run.glyphs);
      const unnamed = glyphs.filter((glyph) => glyph.text === UNREADABLE).length;
      expect(marked).toBe(unnamed);
    },
    180000
  );
});
