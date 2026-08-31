import { describe, expect, it } from 'vitest';
import type { PDFPageProxy } from 'pdfjs-dist';
import { loadPdf } from '@/lib/pdfio';
import { renderPageToCanvas } from '@/lib/pdfjs';
import { readDocumentFacts } from '@/lib/studio/facts';
import { importedStructures } from '@/lib/studio/verify';
import { buildOwnerLockedPdf } from './helpers/encryptedPdf';

/**
 * Two ways Studio could be left holding a document it cannot build.
 *
 * A PDF locked with an owner password only: pdf.js opens it without asking,
 * pdf-lib refuses it on sight, and the two helpers that read the document at
 * the door used to swallow that refusal with every other parse error. So the
 * session was created, and the first rebuild failed inside the worker; and an
 * inserted one was added to the script and failed every rebuild from then on.
 *
 * And a render never cancelled: the Stage effect set a flag and walked away,
 * pdf.js refused the next render on the same canvas, the catch blanked the
 * editor, and the viewport the clicks were mapped through was the old one.
 */

/**
 * The refusals are matched by MESSAGE, not by class. vitest resolves `pdf-lib`
 * to two builds — one for the test, one for the source — so `instanceof
 * EncryptedPDFError` is false across that line even when the error is exactly
 * that. The detector in the source handles both for the same reason, and the
 * comment in src/lib/errors.ts says so.
 */
describe('a PDF locked with an owner password only', () => {
  it('opens in pdf.js with no password at all — which is why the door let it through', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: buildOwnerLockedPdf({ text: 'DESCIFRADO OK' }) });
    const document = await task.promise;
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    await task.destroy();
    // Reading the words back proves the RC4 in the fixture is right: pdf.js
    // derived the same key and decrypted the stream.
    expect(text).toContain('DESCIFRADO OK');
  }, 60000);

  it('is refused by pdf-lib, which is what every rebuild runs on', async () => {
    await expect(loadPdf(buildOwnerLockedPdf())).rejects.toThrow(/is encrypted/i);
  }, 60000);

  it('readDocumentFacts lets that refusal reach the reader instead of swallowing it', async () => {
    // This is the door. Before, the catch returned «no form, no metadata» and
    // the session went ahead.
    await expect(readDocumentFacts(buildOwnerLockedPdf())).rejects.toThrow(/is encrypted/i);
  }, 60000);

  it('importedStructures does too, so an insert is refused before anything is stored', async () => {
    await expect(importedStructures(buildOwnerLockedPdf())).rejects.toThrow(/is encrypted/i);
  }, 60000);

  it('while a file pdf-lib cannot parse for any OTHER reason still answers quietly', async () => {
    // Not a PDF at all: nothing to show, and the run reports it properly. Only
    // encryption is promoted to a refusal, because only encryption is a file
    // the door should never have taken.
    await expect(readDocumentFacts(new Uint8Array([1, 2, 3, 4]))).resolves.toEqual({
      fields: [],
      metadata: {},
      signed: false,
      // Nothing was read, so nothing is claimed about the fonts either.
      fontsByPage: [],
      fontStyles: new Map(),
    });
    await expect(importedStructures(new Uint8Array([1, 2, 3, 4]))).resolves.toEqual([]);
  }, 60000);
});

describe('cancelling a page render', () => {
  /** A page and a canvas with just enough surface for the function under test. */
  function fakes() {
    let cancelled = false;
    let rejectRender: (reason: unknown) => void = () => {};
    let resolveRender: () => void = () => {};
    const page = {
      getViewport: () => ({ width: 100, height: 50 }),
      render: () => ({
        promise: new Promise<void>((resolve, reject) => {
          resolveRender = resolve;
          rejectRender = reject;
        }),
        cancel: () => {
          cancelled = true;
          rejectRender(new Error('RenderingCancelledException'));
        },
      }),
    } as unknown as PDFPageProxy;
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ clearRect() {} }),
    } as unknown as HTMLCanvasElement;
    return { page, canvas, wasCancelled: () => cancelled, finish: () => resolveRender() };
  }

  it('cancels the pdf.js task when the signal aborts', async () => {
    // The shape of the defect: the Stage effect's cleanup ran, nothing told
    // pdf.js, and the next render on the same canvas was refused.
    const { page, canvas, wasCancelled } = fakes();
    const controller = new AbortController();
    const pending = renderPageToCanvas(page, canvas, 1, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(wasCancelled()).toBe(true);
  });

  it('cancels at once when the signal was already aborted', async () => {
    const { page, canvas, wasCancelled } = fakes();
    const controller = new AbortController();
    controller.abort();
    await expect(renderPageToCanvas(page, canvas, 1, { signal: controller.signal })).rejects.toThrow();
    expect(wasCancelled()).toBe(true);
  });

  it('renders to completion when nobody aborts, and sizes the canvas', async () => {
    const { page, canvas, wasCancelled, finish } = fakes();
    const pending = renderPageToCanvas(page, canvas, 2);
    finish();
    const rendered = await pending;
    expect(wasCancelled()).toBe(false);
    expect(rendered.width).toBe(100);
    expect(rendered.height).toBe(50);
  });
});
