/**
 * Where the local OCR engine comes from.
 *
 * Shared because two tools now recognise text — the OCR tool, which builds a
 * whole searchable copy, and Studio, which lays a text layer over one page.
 * Two copies of these numbers would be two chances for them to drift apart.
 */

/** Everything the OCR engine loads is served from this origin, never a CDN. */
export const TESSERACT_PATHS = {
  workerPath: '/vendor/tesseract/worker.min.js',
  corePath: '/vendor/tesseract/core',
  langPath: '/vendor/tesseract/lang',
};
