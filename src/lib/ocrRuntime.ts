/**
 * Where the OCR engine comes from, and how big to draw a page for it.
 *
 * Shared because two tools now recognise text — the OCR tool, which builds a
 * whole searchable copy, and Studio, which lays a text layer over one page.
 * Two copies of these numbers would be two chances for them to drift apart.
 */

/** Rendering scale for recognition. Tesseract needs roughly 300 dpi to read well. */
export const OCR_SCALE = 2;

/** Everything the OCR engine loads is served from this origin, never a CDN. */
export const TESSERACT_PATHS = {
  workerPath: '/vendor/tesseract/worker.min.js',
  corePath: '/vendor/tesseract/core',
  langPath: '/vendor/tesseract/lang',
};
