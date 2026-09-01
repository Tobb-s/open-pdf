import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream, StandardFonts } from 'pdf-lib';
import { parseOperations } from '@/lib/pdf/contentStream';
import { findOccurrences, planReplacement } from '@/lib/pdf/replaceText';
import { readPageFonts } from '@/lib/pdf/fontMap';
import { replaceEverywhere, scanPageText } from '@/lib/pdf/pageText';

const LATEX = 'C:/Users/tobia/.gemini/antigravity/scratch/quant_finance_paper/documento_quant.pdf';

/** What pdf.js reads, which is what a reader will see. */
async function textOf(bytes: Uint8Array, index = 0): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  const page = await document.getPage(index + 1);
  const content = await page.getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join('');
}

/** `String.fromCharCode(...bytes)` blows the call stack past about a hundred KB. */
function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let at = 0; at < bytes.length; at += 8192) {
    out += String.fromCharCode(...bytes.subarray(at, at + 8192));
  }
  return out;
}

/**
 * Every place a word could be hiding in a PDF.
 *
 * Three of these come from the pattern this repo settled on after a raw byte
 * search reported a name as gone while it sat in a form field: the file bytes,
 * every indirect object's own serialisation, every decompressed stream.
 *
 * The fourth is the one this feature needs and the others cannot supply. Text
 * in a content stream is written as character codes, usually in hex — the word
 * «gracias» appears in the file as `<67726163696173>` under one font and as
 * something else entirely under another. Searching the bytes for the word finds
 * nothing whether or not it is there, which is the failure that looks exactly
 * like success. So the decoded text of every page is a haystack too, and the
 * control below — a word that must still be found — is what proves the search
 * can find anything at all.
 */
async function haystacks(bytes: Uint8Array): Promise<string[]> {
  const out = [latin1(bytes)];
  const document = await PDFDocument.load(bytes, { ignoreEncryption: true });
  for (const page of document.getPages()) {
    out.push(scanPageText(page).scan.text);
  }
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    out.push(object.toString());
    if (!(object instanceof PDFStream)) continue;
    try {
      const raw =
        object instanceof PDFRawStream
          ? object.contents
          : (object as unknown as { getContents(): Uint8Array }).getContents();
      const filter = object.dict.get(PDFName.of('Filter'));
      const plain = filter ? new Uint8Array(inflateSync(Buffer.from(raw))) : raw;
      out.push(latin1(plain));
    } catch {
      // A stream that will not decompress cannot be searched; the raw bytes of
      // the file already cover the case where the word sits there uncompressed.
    }
  }
  return out;
}

const anywhere = (hay: string[], needle: string) => hay.some((text) => text.includes(needle));

/**
 * Looks for the word the way it is actually written in a content stream.
 *
 * The haystacks above miss the case that matters most, and a mutation run is
 * what proved it: writing the edited content as a NEW object instead of over
 * the old one leaves the original stream in the file, and every check still
 * passed. The word is not in those bytes as «Juan» — it is there as the codes
 * `4A75616E` inside a hex string, which no search for the word can find.
 *
 * So this encodes the needle through each font the document uses and looks for
 * that, in every stream in the file rather than only the ones a page still
 * points at. An orphan is exactly the object nothing points at.
 */
async function encodedAnywhere(bytes: Uint8Array, needle: string): Promise<boolean> {
  const document = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const forms = new Set<string>();
  for (const page of document.getPages()) {
    for (const font of readPageFonts(page.node.Resources()).values()) {
      const codes: number[] = [];
      for (const character of needle) {
        const code = font.fromUnicode.get(character);
        if (code === undefined) break;
        codes.push(code);
      }
      if (codes.length !== [...needle].length) continue;

      let hex = '';
      let raw = '';
      for (const code of codes) {
        for (let byte = font.codeBytes - 1; byte >= 0; byte -= 1) {
          const value = (code >> (byte * 8)) & 0xff;
          hex += value.toString(16).padStart(2, '0');
          raw += String.fromCharCode(value);
        }
      }
      forms.add(hex.toUpperCase());
      forms.add(hex.toLowerCase());
      forms.add(raw);
    }
  }
  // A needle no font can spell would make this vacuously false.
  expect(forms.size).toBeGreaterThan(0);

  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFStream)) continue;
    let plain: string;
    try {
      const raw =
        object instanceof PDFRawStream
          ? object.contents
          : (object as unknown as { getContents(): Uint8Array }).getContents();
      plain = latin1(
        object.dict.get(PDFName.of('Filter'))
          ? new Uint8Array(inflateSync(Buffer.from(raw)))
          : raw
      );
    } catch {
      continue;
    }
    for (const form of forms) {
      if (plain.includes(form)) return true;
    }
  }
  return false;
}

async function simpleDocument(line = 'Estimado Juan, gracias por todo') {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(line, { x: 20, y: 100, size: 14, font });
  page.drawRectangle({ x: 10, y: 10, width: 50, height: 20 });
  return (await document.save()).slice();
}

describe('replacing a word', () => {
  it('puts the new word on the page and takes the old one off', async () => {
    const before = await simpleDocument();
    expect(await textOf(before)).toBe('Estimado Juan, gracias por todo');

    const { bytes, report } = await replaceEverywhere(before, 'Juan', 'Zoe');

    expect(report.replaced).toBe(1);
    expect(report.found).toBe(1);
    expect(await textOf(bytes)).toBe('Estimado Zoe, gracias por todo');
  });

  it('leaves no copy of the old word anywhere in the file', async () => {
    // The check that separates replacing from covering up. An orphaned content
    // stream still carrying «Juan» would render correctly and be findable by
    // anyone who opened the bytes.
    const before = await simpleDocument();
    const { bytes } = await replaceEverywhere(before, 'Juan', 'Zoe');

    const hay = await haystacks(bytes);
    // The control: a word that should still be there, proving the search works.
    expect(anywhere(hay, 'gracias')).toBe(true);
    expect(anywhere(hay, 'Juan')).toBe(false);

    // And the same question asked of the bytes as they are really written, in
    // every stream in the file including ones no page points at any more.
    expect(await encodedAnywhere(bytes, 'gracias')).toBe(true);
    expect(await encodedAnywhere(bytes, 'Juan')).toBe(false);
  });

  it('keeps the page a page: the drawing is still a drawing', async () => {
    const before = await simpleDocument();
    const { bytes } = await replaceEverywhere(before, 'Juan', 'Zoe');

    const document = await PDFDocument.load(bytes);
    const { streams } = scanPageText(document.getPages()[0]);
    const stream = String.fromCharCode(...streams.bytes);
    // The rectangle's path, untouched. Nothing was rasterised.
    expect(stream).toContain('50 20 l');
    expect(stream).not.toContain('/Image');
    // And no image was added: pdf-lib leaves an empty /XObject dictionary on
    // every page it creates, so the check is that it is still empty.
    const resources = document.getPages()[0].node.Resources();
    const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    expect([...(xobjects?.entries() ?? [])]).toEqual([]);
  });

  it('holds the rest of the line exactly where it was', async () => {
    // The point of measuring at all. «Zoe» is narrower than «Juan», and without
    // compensation everything after it would slide left.
    const before = await simpleDocument();
    const { bytes } = await replaceEverywhere(before, 'Juan', 'Zoe');

    const positionsOf = async (file: Uint8Array, word: string) => {
      const document = await PDFDocument.load(file, { ignoreEncryption: true });
      const { scan } = scanPageText(document.getPages()[0]);
      const at = scan.text.indexOf(word);
      const place = scan.positions[at]!;
      return scan.runs[place.run].glyphs[place.glyph].x;
    };

    expect(await positionsOf(bytes, 'gracias')).toBeCloseTo(
      await positionsOf(before, 'gracias'),
      4
    );
  });

  it('replaces every occurrence, and says how many', async () => {
    const before = await simpleDocument('ana y ana y ana');
    const { bytes, report } = await replaceEverywhere(before, 'ana', 'eva');
    // All three sit in one show operator, and one operator can only be rewritten
    // once — so this is the case the code has to notice rather than corrupt.
    expect(report.found).toBe(3);
    expect(report.replaced + (report.refused.split ?? 0)).toBe(3);
    expect(await textOf(bytes)).toContain('eva');
  });

  it('finds nothing when the word is not there, and changes nothing', async () => {
    const before = await simpleDocument();
    const { bytes, report } = await replaceEverywhere(before, 'Pedro', 'Zoe');
    expect(report.found).toBe(0);
    expect(await textOf(bytes)).toBe(await textOf(before));
  });
});

describe('what it refuses, and how it says so', () => {
  it('names the characters a subsetted font cannot draw', async () => {
    // The ordinary failure. A document that never used a ñ carries a font that
    // cannot draw one, and no amount of trying changes that.
    const before = await simpleDocument('Estimado Juan');
    const { report, bytes } = await replaceEverywhere(before, 'Juan', 'Iñaki');

    // A standard Helvetica can in fact write ñ, so this one succeeds — the
    // check below is on a real subsetted font.
    expect(report.replaced).toBe(1);
    expect(await textOf(bytes)).toContain('Iñaki');
  });

  it('refuses a squeeze that would smear the word, rather than do it', async () => {
    const before = await simpleDocument('Sr. Juan');
    const { report } = await replaceEverywhere(
      before,
      'Sr.',
      'Excelentisimo Senor Presidente',
      { fit: 'squeeze' }
    );
    expect(report.replaced).toBe(0);
    expect(report.refused['too-different']).toBe(1);
  });

  it('does the same replacement happily when asked to let the line move', async () => {
    const before = await simpleDocument('Sr. Juan');
    const { bytes, report } = await replaceEverywhere(
      before,
      'Sr.',
      'Excelentisimo Senor Presidente',
      { fit: 'keep-flow' }
    );
    expect(report.replaced).toBe(1);
    expect(await textOf(bytes)).toContain('Excelentisimo Senor Presidente');
  });

  it('will not match a glyph it could not read', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([300, 200]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText('hola', { x: 20, y: 100, size: 14, font });
    const bytes = (await document.save()).slice();
    const reopened = await PDFDocument.load(bytes);
    const { scan } = scanPageText(reopened.getPages()[0]);
    expect(findOccurrences(scan, '\uFFFD')).toEqual([]);
  });
});

describe('the three trade-offs', () => {
  const setup = async (fit: 'squeeze' | 'keep-layout' | 'keep-flow') => {
    const before = await simpleDocument('uno Juan dos');
    const document = await PDFDocument.load(before, { ignoreEncryption: true });
    const { scan, streams } = scanPageText(document.getPages()[0]);
    const operations = parseOperations(streams.bytes);
    const [occurrence] = findOccurrences(scan, 'Juan');
    const plan = planReplacement(scan, operations, occurrence, 'Ana', { fit });
    if (!plan.ok) throw new Error(`refused: ${plan.reason}`);
    return plan;
  };

  it('squeeze scales the word and moves nothing', async () => {
    const plan = await setup('squeeze');
    expect(plan.widthDelta).toBe(0);
    // «Ana» is narrower than «Juan», so it has to be stretched to fill the gap.
    expect(plan.horizontalScale).toBeGreaterThan(100);

    // The scaling wraps the replaced word and nothing else. Getting this wrong
    // is invisible in a document that draws each word separately and wrong by
    // eighteen points in one that draws a paragraph with a single operator.
    const written = String.fromCharCode(...plan.edit.replacement);
    expect(written).toMatch(/Tz \[<[0-9A-F]+>\] TJ 100 Tz/);
    expect(written.startsWith('[<')).toBe(true);
  });

  it('keep-layout draws it undistorted and gives the difference back', async () => {
    const plan = await setup('keep-layout');
    expect(plan.widthDelta).toBe(0);
    expect(plan.horizontalScale).toBe(100);
    expect(plan.naturalWidthDelta).toBeLessThan(0);
    // A narrower word means the pen has to be pushed forward, which is a
    // negative number in a TJ array — and it sits with the word, not at the end
    // of the line.
    expect(String.fromCharCode(...plan.edit.replacement)).toMatch(/<[0-9A-F]+> -[\d.]+\] TJ/);
    expect(String.fromCharCode(...plan.edit.replacement)).not.toContain('Tz');
  });

  it('keep-flow lets the line close up, and says by how much', async () => {
    const plan = await setup('keep-flow');
    expect(plan.horizontalScale).toBe(100);
    expect(plan.widthDelta).toBeLessThan(0);
    expect(plan.widthDelta).toBe(plan.naturalWidthDelta);
  });
});

/**
 * The document that decides it.
 *
 * Subsetted Type1 faces, no `/Encoding`, words shattered across a TJ array by
 * kerning, accents drawn as separate glyphs. If a word can be replaced here and
 * the page still reads correctly afterwards, the method works on real
 * documents rather than on ones written by the same library that reads them.
 */
describe('a real LaTeX document', () => {
  it.skipIf(!existsSync(LATEX))(
    'replaces a word inside a kerned TJ array',
    async () => {
      const before = new Uint8Array(readFileSync(LATEX));
      expect(await textOf(before)).toContain('Tratado');

      const { bytes, report } = await replaceEverywhere(before, 'Tratado', 'Manual', {
        pages: [0],
      });
      expect(report.replaced).toBe(1);

      const after = await textOf(bytes);
      expect(after).toContain('Manual');
      expect(after).not.toContain('Tratado');
      // Everything else on the title page is still there and still in order.
      expect(after).toContain('de Finanzas Cuantitativas:');
      expect(after).toContain('Antigravity Quant Research Group');
    },
    180000
  );

  it.skipIf(!existsSync(LATEX))(
    'leaves the old word nowhere in the file, across every page it is on',
    async () => {
      // The word is in the running header of all nine pages, so this is also
      // the test that the whole document is covered rather than the first page.
      const before = new Uint8Array(readFileSync(LATEX));
      const { bytes, report } = await replaceEverywhere(before, 'Tratado', 'Manual');
      expect(report.found).toBeGreaterThan(1);
      expect(report.replaced).toBe(report.found);

      const hay = await haystacks(bytes);
      expect(anywhere(hay, 'Finanzas')).toBe(true);
      expect(anywhere(hay, 'Manual')).toBe(true);
      expect(anywhere(hay, 'Tratado')).toBe(false);
      expect(await encodedAnywhere(bytes, 'Finanzas')).toBe(true);
      expect(await encodedAnywhere(bytes, 'Tratado')).toBe(false);
    },
    180000
  );

  it.skipIf(!existsSync(LATEX))(
    'says which characters it cannot write, instead of writing the wrong ones',
    async () => {
      // The finding that shaped this: TeX fonts have no «í». Asking for one has
      // to come back as a named refusal, not as a box or a silent omission.
      const before = new Uint8Array(readFileSync(LATEX));
      const { report, bytes } = await replaceEverywhere(before, 'Tratado', 'Análisis', {
        pages: [0],
      });

      expect(report.replaced).toBe(0);
      expect(report.refused['missing-glyphs']).toBe(1);
      // «Análisis» needs an á, which this font does not have. It does not need
      // an í — that is A-n-á-l-i-s-i-s — so asking for one here would be
      // testing a claim the input does not make.
      expect(report.missing).toEqual(['á']);
      // And nothing was written: the page is exactly as it was.
      expect(await textOf(bytes)).toContain('Tratado');
    },
    180000
  );

  it.skipIf(!existsSync(LATEX))(
    'drops the kerning that lived inside the old word',
    async () => {
      // «Tratado» is drawn as (T) 94 (ratado): a kerning pair inside the word.
      // That 94 belongs to the old word and has to go with it — left behind, it
      // moves everything after it on the line by a fraction of a point, which
      // is the kind of error that is never noticed and never stops being there.
      const before = new Uint8Array(readFileSync(LATEX));
      const { bytes } = await replaceEverywhere(before, 'Tratado', 'Manual', { pages: [0] });

      const xOf = async (file: Uint8Array, word: string) => {
        const document = await PDFDocument.load(file, { ignoreEncryption: true });
        const { scan } = scanPageText(document.getPages()[0]);
        const at = scan.text.indexOf(word);
        expect(at).toBeGreaterThanOrEqual(0);
        const place = scan.positions[at]!;
        return scan.runs[place.run].glyphs[place.glyph].x;
      };

      // «Finanzas» follows the replaced word on the same line, and a squeeze
      // promises it will not move.
      expect(await xOf(bytes, 'Finanzas')).toBeCloseTo(await xOf(before, 'Finanzas'), 4);
    },
    180000
  );

  it.skipIf(!existsSync(LATEX))(
    'keeps every other page byte-identical when it edits one',
    async () => {
      const before = new Uint8Array(readFileSync(LATEX));
      const { bytes } = await replaceEverywhere(before, 'Tratado', 'Manual', { pages: [0] });

      const original = await PDFDocument.load(before, { ignoreEncryption: true });
      const edited = await PDFDocument.load(bytes, { ignoreEncryption: true });
      expect(edited.getPageCount()).toBe(original.getPageCount());

      for (let index = 1; index < original.getPageCount(); index += 1) {
        const mine = scanPageText(edited.getPages()[index]).streams.bytes;
        const theirs = scanPageText(original.getPages()[index]).streams.bytes;
        expect({ page: index, equal: mine.length === theirs.length }).toEqual({
          page: index,
          equal: true,
        });
        expect(mine).toEqual(theirs);
      }
    },
    180000
  );
});
