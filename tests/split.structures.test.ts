import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { savePdf } from '@/lib/pdfio';
import { applyPageEdits } from '@/lib/pageEdits';
import { canTrimTo, parsePageRange } from '@/lib/pageRange';
import { reportStructures, summarizeStructures } from '@/lib/verify/structural';
import { buildRichPdf, pageWidth } from './helpers/richPdf';

/**
 * Splitting used to assemble a new document with `copyPages`, which is the
 * exact operation `pageEdits.ts` was written to replace. Measured on this
 * project's own fixture, asking for pages 1-5 of a five-page document — the
 * whole file — came back 25% smaller with the form, the bookmarks, the
 * attachment, the page labels, the title and the language all gone, under a
 * green tick that said «Tu descarga está lista.»
 *
 * The range mode now trims the original instead. The ZIP modes cannot: every
 * part is a different document, so there is nothing to trim and nothing to
 * compare a part against. They say what the source carried instead.
 */

let fixture: Uint8Array;

beforeAll(async () => {
  fixture = await buildRichPdf(5);
});

/** What the tool does for a selection with no repeats. */
async function splitByRange(bytes: Uint8Array, range: string, pageCount: number) {
  const parsed = parsePageRange(range, pageCount);
  // The same decision the tool makes, from the same function it calls.
  expect(canTrimTo(parsed.pages)).toBe(true);
  const wanted = parsed.pages.map((page) => page - 1);
  return applyPageEdits(
    bytes,
    wanted.map((sourceIndex) => ({ sourceIndex, rotation: 0 }))
  );
}

/** What it used to do, and still does when the selection repeats a page. */
async function splitByCopy(bytes: Uint8Array, range: string, pageCount: number) {
  const parsed = parsePageRange(range, pageCount);
  const source = await PDFDocument.load(bytes);
  const output = await PDFDocument.create();
  const copied = await output.copyPages(
    source,
    parsed.pages.map((page) => page - 1)
  );
  for (const page of copied) output.addPage(page);
  return (await savePdf(output)).slice();
}

describe('splitting a range', () => {
  it('THE GATE: keeps the six things the old assembly destroyed', async () => {
    const out = await splitByRange(fixture, '1-5', 5);
    const report = await reportStructures(fixture, out);
    expect(report.losses).toEqual([]);
    expect(report.present).toEqual([
      'form',
      'bookmarks',
      'attachments',
      'pageLabels',
      'metadataTitle',
      'language',
    ]);
  }, 60000);

  it('and the old way really did destroy them, so the gate is not vacuous', async () => {
    const out = await splitByCopy(fixture, '1-5', 5);
    const lost = (await reportStructures(fixture, out)).losses.map((loss) => loss.category);
    expect(lost).toContain('form');
    expect(lost).toContain('bookmarks');
    expect(lost).toContain('attachments');
    expect(lost).toContain('metadataTitle');
    expect(lost).toContain('language');
  }, 60000);

  it('extracts the pages that were asked for, in the order asked for', async () => {
    const out = await splitByRange(fixture, '4,2', 5);
    const document = await PDFDocument.load(out);
    expect(document.getPages().map((page) => Math.round(page.getWidth()))).toEqual([
      pageWidth(3),
      pageWidth(1),
    ]);
  }, 60000);

  it('handles a reversed range, which is three pages in a different order', async () => {
    // `parsePageRange` counts backwards on purpose, and no page repeats, so the
    // trimming path takes it.
    const parsed = parsePageRange('5-3', 5);
    expect(parsed.pages).toEqual([5, 4, 3]);
    expect(new Set(parsed.pages).size).toBe(parsed.pages.length);

    const out = await splitByRange(fixture, '5-3', 5);
    const document = await PDFDocument.load(out);
    expect(document.getPages().map((page) => Math.round(page.getWidth()))).toEqual([
      pageWidth(4),
      pageWidth(3),
      pageWidth(2),
    ]);
  }, 60000);

  it('drops the page labels once the sequence changes, rather than keeping wrong ones', async () => {
    const out = await splitByRange(fixture, '3,1', 5);
    const after = summarizeStructures(await PDFDocument.load(out));
    // Labels bind to page INDICES; after a reorder they point at the wrong
    // pages, so pageEdits removes them and the card reports the loss.
    expect(after.categories.pageLabels).toBe(0);
    const lost = (await reportStructures(fixture, out)).losses.map((loss) => loss.category);
    expect(lost).toContain('pageLabels');
  }, 60000);
});

describe('a selection that repeats a page', () => {
  it('cannot be trimmed, because a page cannot be deleted twice', async () => {
    const parsed = parsePageRange('1,1,2', 5);
    // Repeats are allowed on purpose: a reader may want a page duplicated.
    expect(parsed.pages).toEqual([1, 1, 2]);

    await expect(
      applyPageEdits(
        fixture,
        parsed.pages.map((page) => ({ sourceIndex: page - 1, rotation: 0 }))
      )
    ).rejects.toThrow();
  }, 60000);

  it('so it falls back to assembly, and the losses are reported rather than hidden', async () => {
    const out = await splitByCopy(fixture, '1,1,2', 5);
    const document = await PDFDocument.load(out);
    expect(document.getPageCount()).toBe(3);

    const lost = (await reportStructures(fixture, out)).losses.map((loss) => loss.category);
    expect(lost.length).toBeGreaterThan(0);
  }, 60000);
});

describe('canTrimTo, which is the decision the tool makes', () => {
  it('says yes to a plain range, a reordering and a reversed range', () => {
    expect(canTrimTo(parsePageRange('1-5', 5).pages)).toBe(true);
    expect(canTrimTo(parsePageRange('4,2', 5).pages)).toBe(true);
    expect(canTrimTo(parsePageRange('5-3', 5).pages)).toBe(true);
  });

  it('says no only when a page is asked for twice', () => {
    expect(canTrimTo(parsePageRange('1,1,2', 5).pages)).toBe(false);
    expect(canTrimTo(parsePageRange('1-3,2', 5).pages)).toBe(false);
  });
});
