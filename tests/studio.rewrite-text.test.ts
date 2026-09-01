import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFDict, StandardFonts } from 'pdf-lib';
import { materialize } from '@/lib/studio/materialize';
import { stateAt, type Edit } from '@/lib/studio/script';
import { scanPageText } from '@/lib/pdf/pageText';

const LATEX = 'C:/Users/tobia/.gemini/antigravity/scratch/quant_finance_paper/documento_quant.pdf';

async function textOf(bytes: Uint8Array, index = 0): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  const page = await document.getPage(index + 1);
  const content = await page.getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join('');
}

async function letter(line = 'Estimado Juan, gracias por su tiempo') {
  const document = await PDFDocument.create();
  const page = document.addPage([420, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(line, { x: 20, y: 120, size: 13, font });
  page.drawRectangle({ x: 20, y: 30, width: 80, height: 30 });
  return (await document.save()).slice();
}

const rewrite = (
  needle: string,
  replacement: string,
  fit: 'squeeze' | 'keep-layout' | 'keep-flow' = 'squeeze',
  occurrence: number | 'all' = 'all'
): Edit => ({
  kind: 'rewriteText',
  page: 'o0',
  rewrite: { needle, replacement, fit, occurrence },
});

const build = async (original: Uint8Array, edits: Edit[], pages = 1) =>
  materialize({
    original,
    assets: new Map(),
    state: stateAt(pages, edits, edits.length),
  });

describe('replacing a word through the edit script', () => {
  it('changes the word and keeps the page a page', async () => {
    const original = await letter();
    const { bytes, rewrites } = await build(original, [rewrite('Juan', 'Zoe')]);

    expect(await textOf(bytes)).toBe('Estimado Zoe, gracias por su tiempo');
    expect(rewrites).toHaveLength(1);
    expect(rewrites[0]).toMatchObject({ page: 'o0', found: 1, replaced: 1, refused: [] });

    // Nothing was photographed: the rectangle is still a path and the page
    // still has no image.
    const document = await PDFDocument.load(bytes);
    const stream = String.fromCharCode(...scanPageText(document.getPages()[0]).streams.bytes);
    expect(stream).toContain(' l\n');
    const xobjects = document
      .getPages()[0]
      .node.Resources()
      ?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    expect([...(xobjects?.entries() ?? [])]).toEqual([]);
  });

  it('is not mistaken for an untouched document', async () => {
    // The guard that matters most for this edit. `materialize` hands back the
    // original bytes when the script asked for nothing, and a rewrite that was
    // not counted as «something» would come back as the file that went in —
    // reported as success, with the old word still on the page.
    const original = await letter();
    const { bytes } = await build(original, [rewrite('Juan', 'Zoe')]);
    expect(bytes).not.toEqual(original);
    expect(await textOf(bytes)).not.toContain('Juan');
  });

  it('composes: the second rewrite sees what the first did', async () => {
    const original = await letter('Estimado Juan, saludos Juan');
    const { bytes, rewrites } = await build(original, [
      rewrite('Juan', 'Zoe', 'squeeze', 0),
      rewrite('Zoe', 'Ana', 'squeeze', 0),
    ]);

    expect(rewrites.map((entry) => entry.replaced)).toEqual([1, 1]);
    const text = await textOf(bytes);
    expect(text).toContain('Ana');
    expect(text).not.toContain('Zoe');
  });

  it('undoes cleanly, because the edit is the intent and not the bytes', async () => {
    const original = await letter();
    const edits = [rewrite('Juan', 'Zoe')];
    const undone = await materialize({
      original,
      assets: new Map(),
      state: stateAt(1, edits, 0),
    });
    // With the cursor before the edit, the file is the one that was opened.
    expect(undone.bytes).toEqual(original);
    expect(undone.rewrites).toEqual([]);
  });

  it('says so when the page has no such word', async () => {
    const original = await letter();
    const { bytes, rewrites } = await build(original, [rewrite('Pedro', 'Zoe')]);
    expect(rewrites[0]).toMatchObject({ found: 0, replaced: 0 });
    expect(await textOf(bytes)).toContain('Juan');
  });
});

describe('what the reader is told when it cannot be done', () => {
  it.skipIf(!existsSync(LATEX))(
    'names the characters the page font cannot draw',
    async () => {
      const original = new Uint8Array(readFileSync(LATEX));
      const { bytes, rewrites } = await build(
        original,
        [rewrite('Tratado', 'Análisis')],
        9
      );

      expect(rewrites[0].replaced).toBe(0);
      expect(rewrites[0].refused).toEqual(['missing-glyphs']);
      expect(rewrites[0].missing).toEqual(['á']);
      // And the page was left alone rather than half-changed.
      expect(await textOf(bytes)).toContain('Tratado');
    },
    180000
  );

  it.skipIf(!existsSync(LATEX))(
    'replaces a word inside a kerned array and leaves the rest of the line still',
    async () => {
      const original = new Uint8Array(readFileSync(LATEX));
      const { bytes, rewrites } = await build(original, [rewrite('Tratado', 'Manual')], 9);
      expect(rewrites[0].replaced).toBe(1);

      const xOf = async (file: Uint8Array, word: string) => {
        const document = await PDFDocument.load(file, { ignoreEncryption: true });
        const { scan } = scanPageText(document.getPages()[0]);
        const at = scan.text.indexOf(word);
        expect(at).toBeGreaterThanOrEqual(0);
        const place = scan.positions[at]!;
        return scan.runs[place.run].glyphs[place.glyph].x;
      };
      expect(await xOf(bytes, 'Finanzas')).toBeCloseTo(await xOf(original, 'Finanzas'), 4);
    },
    180000
  );
});
