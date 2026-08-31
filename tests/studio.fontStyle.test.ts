import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFString, StandardFonts } from 'pdf-lib';
import { baseFontName, choiceFor, describeFont, fontsOnPage } from '@/lib/studio/fontStyle';

/**
 * Reading weight and slant out of a PDF.
 *
 * Nothing in a PDF says "bold". It says the font is called
 * `KLMNOP+TimesNewRomanPS-BoldItalicMT`, that flag 19 of its descriptor is set,
 * that its `/ItalicAngle` is -15 and its `/StemV` is 165 — and every producer
 * records a different subset of that. Word never sets ForceBold; LaTeX often
 * gives only a name; a synthesised face may give only a stem width. So each
 * source is tested on its own, because in the wild each one arrives on its own.
 */

/** A font dictionary with exactly the entries a test wants to try. */
function fontDict(
  document: PDFDocument,
  name: string,
  descriptor?: Record<string, number>
): PDFDict {
  const dict = document.context.obj({ Type: 'Font', BaseFont: PDFString.of(name) });
  if (descriptor) {
    const entries: Record<string, PDFNumber> = {};
    for (const [key, value] of Object.entries(descriptor)) entries[key] = PDFNumber.of(value);
    dict.set(
      PDFName.of('FontDescriptor'),
      document.context.register(document.context.obj(entries))
    );
  }
  return dict;
}

describe('the subset prefix', () => {
  it('is stripped, because it is not part of the name', () => {
    expect(baseFontName('KLMNOP+Arial-BoldMT')).toBe('Arial-BoldMT');
    expect(baseFontName('/ABCDEF+Times-Roman')).toBe('Times-Roman');
  });

  it('leaves a name that merely contains a plus alone', () => {
    expect(baseFontName('Foo+Bar')).toBe('Foo+Bar');
    expect(baseFontName('Helvetica')).toBe('Helvetica');
  });
});

describe('reading the shape from the name alone', () => {
  it('finds bold and italic however the producer spells them', async () => {
    const document = await PDFDocument.create();
    const cases: Array<[string, boolean, boolean]> = [
      ['Arial-BoldMT', true, false],
      ['Times-Italic', false, true],
      ['TimesNewRomanPS-BoldItalicMT', true, true],
      ['Helvetica-Oblique', false, true],
      ['SomeFont-Black', true, false],
      ['SomeFont-SemiBold', true, false],
      ['Helvetica', false, false],
    ];
    for (const [name, bold, italic] of cases) {
      const font = describeFont(document, fontDict(document, name));
      expect([name, font?.bold, font?.italic]).toEqual([name, bold, italic]);
    }
  });

  it('is not fooled by a word that merely contains one', async () => {
    // «Bolder» is not bold and «Boldoni» is a display face; matching on a
    // substring would call both of them heavy.
    const document = await PDFDocument.create();
    expect(describeFont(document, fontDict(document, 'Bolder'))?.bold).toBe(false);
    expect(describeFont(document, fontDict(document, 'Boldoni-Regular'))?.bold).toBe(false);
  });
});

describe('reading the shape from the descriptor', () => {
  it('believes the ForceBold flag even when the name says nothing', async () => {
    const document = await PDFDocument.create();
    const font = describeFont(document, fontDict(document, 'MiFuente', { Flags: 1 << 18 }));
    expect(font?.bold).toBe(true);
  });

  it('believes the Italic flag', async () => {
    const document = await PDFDocument.create();
    expect(describeFont(document, fontDict(document, 'MiFuente', { Flags: 1 << 6 }))?.italic).toBe(
      true
    );
  });

  it('believes a numeric weight', async () => {
    const document = await PDFDocument.create();
    expect(describeFont(document, fontDict(document, 'X', { FontWeight: 700 }))?.bold).toBe(true);
    expect(describeFont(document, fontDict(document, 'X', { FontWeight: 400 }))?.bold).toBe(false);
  });

  it('believes a slant angle, in either direction', async () => {
    const document = await PDFDocument.create();
    expect(describeFont(document, fontDict(document, 'X', { ItalicAngle: -15 }))?.italic).toBe(true);
    expect(describeFont(document, fontDict(document, 'X', { ItalicAngle: 12 }))?.italic).toBe(true);
    expect(describeFont(document, fontDict(document, 'X', { ItalicAngle: 0 }))?.italic).toBe(false);
  });

  it('falls back to the stem width, but only when nothing said outright', async () => {
    const document = await PDFDocument.create();
    // A measurement, not a declaration: a heavy stem is evidence.
    expect(describeFont(document, fontDict(document, 'X', { StemV: 165 }))?.bold).toBe(true);
    expect(describeFont(document, fontDict(document, 'X', { StemV: 80 }))?.bold).toBe(false);
  });

  it('reads serif and fixed pitch, which decide the family', async () => {
    const document = await PDFDocument.create();
    expect(describeFont(document, fontDict(document, 'X', { Flags: 1 << 1 }))?.family).toBe('times');
    expect(describeFont(document, fontDict(document, 'X', { Flags: 1 << 0 }))?.family).toBe(
      'courier'
    );
    expect(describeFont(document, fontDict(document, 'X'))?.family).toBe('helvetica');
  });

  it('reads a Type 0 font through its descendant, where the descriptor lives', async () => {
    const document = await PDFDocument.create();
    const descriptor = document.context.register(
      document.context.obj({ Flags: PDFNumber.of(1 << 18), ItalicAngle: PDFNumber.of(-12) })
    );
    const descendant = document.context.register(
      document.context.obj({ Type: 'Font', Subtype: 'CIDFontType2', FontDescriptor: descriptor })
    );
    const composite = document.context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: PDFString.of('ABCDEF+NotoSans'),
      DescendantFonts: document.context.obj([descendant]),
    });

    const font = describeFont(document, composite);
    expect(font?.name).toBe('NotoSans');
    expect(font?.bold).toBe(true);
    expect(font?.italic).toBe(true);
  });
});

describe('what a page reports', () => {
  it('lists the fonts it can draw with, once each', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([400, 300]);
    const helvetica = await document.embedFont(StandardFonts.Helvetica);
    const bold = await document.embedFont(StandardFonts.HelveticaBold);
    const italic = await document.embedFont(StandardFonts.TimesRomanItalic);
    page.drawText('llano', { x: 10, y: 200, font: helvetica, size: 12 });
    page.drawText('fuerte', { x: 10, y: 160, font: bold, size: 12 });
    page.drawText('inclinado', { x: 10, y: 120, font: italic, size: 12 });
    // Twice, to prove it is deduplicated rather than listed per use.
    page.drawText('fuerte otra vez', { x: 10, y: 80, font: bold, size: 12 });

    const reopened = await PDFDocument.load(await document.save());
    const fonts = fontsOnPage(reopened, reopened.getPage(0));
    const summary = fonts
      .map((font) => `${font.name}:${font.bold ? 'B' : '-'}${font.italic ? 'I' : '-'}`)
      .sort();

    expect(summary).toEqual([
      'Helvetica-Bold:B-',
      'Helvetica:--',
      'Times-Italic:-I',
    ]);
  });

  it('says nothing about a page with no text at all', async () => {
    const document = await PDFDocument.create();
    document.addPage([400, 300]);
    const reopened = await PDFDocument.load(await document.save());
    expect(fontsOnPage(reopened, reopened.getPage(0))).toEqual([]);
  });

  it('finds a font the page inherits rather than declares', async () => {
    // `/Resources` is inheritable. A producer that puts the fonts on the Pages
    // node and nothing on the page is unusual but legal, and a reader that only
    // looked at the leaf would report a page with text as having no fonts.
    const document = await PDFDocument.create();
    const page = document.addPage([400, 300]);
    const font = await document.embedFont(StandardFonts.HelveticaBold);
    page.drawText('hola', { x: 10, y: 100, font, size: 12 });

    const saved = await PDFDocument.load(await document.save());
    const leaf = saved.getPage(0);
    const resources = leaf.node.get(PDFName.of('Resources'));
    // Move them up to the parent and take them off the page.
    const parent = saved.context.lookup(leaf.node.get(PDFName.of('Parent')), PDFDict);
    parent.set(PDFName.of('Resources'), resources!);
    leaf.node.delete(PDFName.of('Resources'));

    expect(fontsOnPage(saved, leaf).map((each) => each.name)).toEqual(['Helvetica-Bold']);
  });
});

describe('matching the editor to what it found', () => {
  it('turns a detected font into the choice the text tool takes', async () => {
    const document = await PDFDocument.create();
    const font = describeFont(document, fontDict(document, 'TimesNewRomanPS-BoldItalicMT'));
    expect(choiceFor(font!)).toEqual({ family: 'times', bold: true, italic: true });
  });

  it('maps a font the editor cannot embed to the nearest one it can', async () => {
    // The document's own font is not reusable: what is embedded is a SUBSET,
    // holding only the glyphs already used, so new text would come out with
    // missing letters. The shape is what carries over.
    const document = await PDFDocument.create();
    const font = describeFont(document, fontDict(document, 'ABCDEF+Garamond-Bold'));
    expect(font?.name).toBe('Garamond-Bold');
    expect(choiceFor(font!)).toEqual({ family: 'times', bold: true, italic: false });
  });
});
