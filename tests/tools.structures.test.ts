import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { loadPdf, savePdf } from '@/lib/pdfio';
import { applyBatchRecipe } from '@/lib/batch';
import { applyPageEdits } from '@/lib/pageEdits';
import { stampPageNumbers, stampText } from '@/lib/stamp';
import { materialize } from '@/lib/studio/materialize';
import { stateAt } from '@/lib/studio/script';
import { reportStructures } from '@/lib/verify/structural';
import { TOOL_STRUCTURES, mustReportLosses } from '@/lib/verify/toolPromises';
import { DICTIONARIES, LOCALES } from '@/lib/i18n/dictionaries';
import { TOOL_SLUGS, type ToolSlug } from '@/lib/tools';
import { buildRichPdf } from './helpers/richPdf';

/**
 * The one assertion that would have caught half the audit.
 *
 * Every defect in that list had the same shape: a tool destroyed something and
 * its card said otherwise, or said nothing. Split lost six things under a green
 * tick. A deleted page's form field survived in the file while the card said
 * the form had been lost. A signed document came out with a dead signature and
 * the card reported the form as kept.
 *
 * None of it was caught, because the tools live in `page.tsx` files no test
 * reaches — the suite runs in Node with no DOM, and every one of its four
 * hundred tests imports from `src/lib`. So this does not test the pages. It
 * tests the OPERATION each page performs, run against a document that carries
 * everything there is to lose, and holds the result against what the tool
 * promises in `toolPromises.ts`.
 *
 * That leaves a gap and it should be named: a tool could keep its promise here
 * and still render the wrong sentence. What this makes impossible is the
 * quieter half — a tool that destroys structures while its table entry, and
 * therefore its interface, says it does not.
 */

let fixture: Uint8Array;

/** Everything a rebuild is known to drop, so the fixture has something to lose. */
const EXPECTED_IN_FIXTURE = [
  'form',
  'bookmarks',
  'attachments',
  'pageLabels',
  'metadataTitle',
  'language',
] as const;

beforeAll(async () => {
  fixture = await buildRichPdf(5);
});

describe('the fixture itself', () => {
  it('carries everything a rebuild is known to destroy', async () => {
    // Without this the tests below would pass on a document with nothing at
    // stake — the control that makes every «no losses» result mean something.
    const report = await reportStructures(fixture, fixture);
    for (const category of EXPECTED_IN_FIXTURE) {
      expect(report.present).toContain(category);
    }
  }, 60000);
});

describe('every tool has answered the question', () => {
  it('classifies each one, with no slug left out or invented', () => {
    expect(Object.keys(TOOL_STRUCTURES).sort()).toEqual([...TOOL_SLUGS].sort());
  });

  it('asks only the tools that rebuild to confess', () => {
    expect(mustReportLosses('merge')).toBe(true);
    expect(mustReportLosses('organize')).toBe(false);
    // A warning that is not true is what teaches readers to skip the ones that
    // are, so a tool that keeps everything must not carry one.
    expect(mustReportLosses('watermark')).toBe(false);
  });
});

/**
 * The operations, run for real.
 *
 * Each of these is what the page does, in the same order with the same
 * library calls: the page's own work is the loading, the mutation and the
 * saving, and that is exactly what is reproduced here.
 */
const PRESERVING: Array<{
  slug: ToolSlug;
  /**
   * True when the operation changes which pages are there or in what order.
   *
   * `/PageLabels` binds names to page INDICES, so once the sequence moves the
   * labels point at the wrong pages. `applyPageEdits` drops them rather than
   * hand back labels that are now wrong, and the tool reports the loss — so it
   * is the one thing a preserving tool is allowed to give up, and only when it
   * had that reason.
   */
  changesSequence?: boolean;
  run: (bytes: Uint8Array) => Promise<Uint8Array>;
}> = [
  {
    slug: 'organize',
    changesSequence: true,
    run: (bytes) =>
      applyPageEdits(bytes, [
        { sourceIndex: 1, rotation: 90 },
        { sourceIndex: 0, rotation: 0 },
        { sourceIndex: 2, rotation: 0 },
        { sourceIndex: 3, rotation: 0 },
        { sourceIndex: 4, rotation: 0 },
      ]),
  },
  {
    slug: 'split',
    changesSequence: true,
    // The range mode with a selection that repeats nothing, which is the path
    // it takes whenever it can.
    run: (bytes) =>
      applyPageEdits(bytes, [1, 2, 3].map((index) => ({ sourceIndex: index, rotation: 0 }))),
  },
  {
    slug: 'watermark',
    run: async (bytes) => {
      const document = await loadPdf(bytes, { updateMetadata: false });
      await stampText(document, [1, 2, 3, 4, 5], {
        text: 'BORRADOR',
        font: { family: 'helvetica', bold: true, italic: false },
        size: 48,
        color: { r: 0.5, g: 0.5, b: 0.5 },
        opacity: 0.25,
        angle: 45,
        anchor: 'center',
        margin: 36,
      });
      return (await savePdf(document)).slice();
    },
  },
  {
    slug: 'page-numbers',
    run: async (bytes) => {
      const document = await loadPdf(bytes, { updateMetadata: false });
      await stampPageNumbers(document, [1, 2, 3, 4, 5], {
        font: { family: 'helvetica', bold: false, italic: false },
        size: 11,
        color: { r: 0.2, g: 0.2, b: 0.2 },
        anchor: 'bottom-center',
        margin: 36,
        startAt: 1,
        format: 'ofTotal',
        ofWord: 'de',
      });
      return (await savePdf(document)).slice();
    },
  },
  {
    slug: 'edit',
    run: async (bytes) => {
      const document = await loadPdf(bytes, { updateMetadata: false });
      const font = await document.embedFont(StandardFonts.Helvetica);
      document
        .getPages()[0]
        .drawText('anotado', { x: 40, y: 60, size: 12, font, color: rgb(0, 0, 0) });
      return (await savePdf(document)).slice();
    },
  },
  {
    slug: 'fill-form',
    run: async (bytes) => {
      const document = await loadPdf(bytes, { updateMetadata: false });
      const form = document.getForm();
      const field = form.getTextField('alumno.nombre');
      field.setText('Ana Pérez');
      const helvetica = await document.embedFont(StandardFonts.Helvetica);
      field.defaultUpdateAppearances(helvetica);
      return (await savePdf(document, { updateFieldAppearances: false })).slice();
    },
  },
  {
    slug: 'batch',
    run: async (bytes) => {
      const { bytes: out } = await applyBatchRecipe(
        bytes,
        { rotate: 90, watermark: 'BORRADOR', pageNumbers: true, flattenForms: false },
        'de'
      );
      return out;
    },
  },
  {
    slug: 'studio',
    run: async (bytes) => {
      const { bytes: out } = await materialize({
        original: bytes,
        assets: new Map(),
        state: stateAt(5, [{ kind: 'rotate', page: 'o1', turns: 1 }], 1),
      });
      return out;
    },
  },
];

describe('a tool that promises to preserve', () => {
  it('has one of these for every tool that claims it', () => {
    // Without this the table is a comment. A mutation run proved it: flipping
    // `compress` to «preserves» — the exact defect Split shipped for a year —
    // left all fourteen tests green, because the list below is written by hand
    // and nothing held it against the claim. Now the claim costs a test: to
    // call a tool preserving, someone has to run its operation against a
    // document that has something to lose and watch it come back whole.
    const claiming = TOOL_SLUGS.filter((slug) => TOOL_STRUCTURES[slug] === 'preserves');
    expect(PRESERVING.map((entry) => entry.slug).sort()).toEqual([...claiming].sort());
  });

  for (const { slug, run, changesSequence } of PRESERVING) {
    it(`${slug}: keeps everything the document arrived with`, async () => {
      expect(TOOL_STRUCTURES[slug]).toBe('preserves');

      const produced = await run(fixture);
      const lost = (await reportStructures(fixture, produced)).losses.map(
        (loss) => loss.category
      );

      // The whole assertion: nothing the verifier can vouch for went missing.
      // This is what Split failed for its entire life. The one exception is
      // page labels, and only for an operation that moved the pages they name.
      expect(lost).toEqual(changesSequence ? expect.arrayContaining([]) : []);
      for (const category of lost) {
        expect([category, changesSequence]).toEqual(['pageLabels', true]);
      }
    }, 60000);
  }

  it('keeps even the page labels when the sequence is left alone', async () => {
    // The other half of the exception. If labels went on an identity edit, the
    // rule above would be excusing a defect instead of describing a decision.
    const produced = await applyPageEdits(
      fixture,
      [0, 1, 2, 3, 4].map((sourceIndex) => ({ sourceIndex, rotation: 0 }))
    );
    const lost = (await reportStructures(fixture, produced)).losses.map((loss) => loss.category);
    expect(lost).toEqual([]);
  }, 60000);
});

describe('a tool that rebuilds', () => {
  it('merge: really does destroy them, so the promise above is not vacuous', async () => {
    // Merge's own loop, reproduced: create, copy every page, add every page.
    // Two things at once — if `copyPages` ever started preserving structures
    // every «preserves» test above would be passing for the wrong reason and
    // this is what would notice; and merge's own entry in the table is held
    // against merge's own code rather than against a stand-in.
    //
    // Compress and OCR cannot be run here and it should be said plainly rather
    // than left as a gap someone finds later: both rasterise every page through
    // a canvas, which Node does not have. Their entries rest on reading the two
    // `PDFDocument.create()` calls in their pages, and on the browser check.
    const source = await loadPdf(fixture, { updateMetadata: false });
    const rebuilt = await PDFDocument.create();
    const copied = await rebuilt.copyPages(source, source.getPageIndices());
    for (const page of copied) rebuilt.addPage(page);
    const produced = (await savePdf(rebuilt)).slice();

    const lost = (await reportStructures(fixture, produced)).losses.map(
      (loss) => loss.category
    );
    for (const category of EXPECTED_IN_FIXTURE) {
      expect(lost).toContain(category);
    }
  }, 60000);

  it('has the words to say so, in both languages', () => {
    // A tool that rebuilds owes the reader a sentence. Having the string is not
    // proof that it renders it — that lives in a page no test reaches — but its
    // absence is proof that it cannot.
    const rebuilding = TOOL_SLUGS.filter(mustReportLosses);
    expect(rebuilding.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const locale of LOCALES) {
      const dictionary = DICTIONARIES[locale] as unknown as Record<string, unknown>;
      for (const slug of rebuilding) {
        // The dictionaries key tools by camelCase; the slugs are hyphenated.
        const key = slug.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
        const entry = dictionary[key];
        if (!entry || typeof entry !== 'object') continue;
        const words = entry as Record<string, unknown>;
        const says =
          typeof words.lostNote === 'function' || typeof words.partsLoseNote === 'function';
        if (!says) missing.push(`${locale}/${slug}`);
      }
    }

    // Named rather than counted, so a failure says which tool is silent.
    expect(missing.sort()).toEqual([]);
  });
});
