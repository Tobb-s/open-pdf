import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';

/**
 * Everything pdf.js loads at runtime is served from this origin, copied out of
 * node_modules by scripts/vendor-assets.mjs. Nothing is fetched from a CDN, so a
 * compromised third party cannot run code on the page holding the user's document.
 */
const VENDOR = '/vendor/pdfjs';

/**
 * The legacy build, deliberately.
 *
 * `pdfjs-dist` resolves to the modern build, which needs very recent engines —
 * the tightest constraint is `Map.prototype.getOrInsertComputed`, on the
 * required path — and the failure is not a clean one: pdf.js wraps any worker
 * exception in `UnknownErrorException`, which this project maps to «this file
 * is not a readable PDF». So an older browser was told its document was broken.
 *
 * The legacy build ships the core-js polyfills and is already what every test
 * imports, which means the suite was exercising a different binary from the one
 * being served.
 */
type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let modulePromise: Promise<PdfJsModule> | null = null;

export function loadPdfJs(): Promise<PdfJsModule> {
  modulePromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((module) => {
    module.GlobalWorkerOptions.workerSrc = `${VENDOR}/pdf.worker.min.mjs`;
    return module;
  });
  return modulePromise;
}

export interface OpenPdfResult {
  document: PDFDocumentProxy;
  /** Releases the worker. Always call it, including on the error path. */
  destroy: () => Promise<void>;
}

/**
 * Opens a PDF with pdf.js without consuming the caller's bytes.
 *
 * pdf.js transfers the buffer it is given to its worker thread, which leaves the
 * original detached and zero-length. Anything that needs the same bytes
 * afterwards — pdf-lib, a second pass, a retry — would silently receive nothing,
 * so every caller gets a copy made here rather than having to remember.
 */
export async function openPdf(source: ArrayBuffer | Uint8Array): Promise<OpenPdfResult> {
  const pdfjs = await loadPdfJs();
  const bytes = source instanceof Uint8Array ? source.slice() : new Uint8Array(source.slice(0));

  const task = pdfjs.getDocument({
    data: bytes,
    cMapUrl: `${VENDOR}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${VENDOR}/standard_fonts/`,
    wasmUrl: `${VENDOR}/wasm/`,
    iccUrl: `${VENDOR}/iccs/`,
  });

  const document = await task.promise;
  return {
    document,
    destroy: async () => {
      await task.destroy();
    },
  };
}

/**
 * Renders one page onto a canvas at the requested scale, sizing the canvas to match.
 */
export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number
): Promise<{ width: number; height: number; viewport: PageViewport }> {
  const viewport = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('This browser did not provide a 2D canvas context.');
  }
  context.clearRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvas, canvasContext: context, viewport }).promise;
  // The viewport travels with the pixels: it is the only correct way to map a
  // click on this render back to PDF user space (rotation and CropBox included).
  return { width: canvas.width, height: canvas.height, viewport };
}

/** Renders a page into a detached canvas and returns it as a JPEG blob. */
export async function renderPageToJpeg(
  page: PDFPageProxy,
  scale: number,
  quality: number
): Promise<{ blob: Blob; width: number; height: number }> {
  const canvas = document.createElement('canvas');
  const { width, height } = await renderPageToCanvas(page, canvas, scale);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });

  // Free the backing store now rather than waiting for the collector; a long
  // document otherwise keeps every page's pixels alive at once.
  canvas.width = 0;
  canvas.height = 0;

  if (!blob) {
    throw new Error('The browser could not encode the rendered page.');
  }
  return { blob, width, height };
}
