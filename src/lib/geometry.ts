/**
 * The one place screen coordinates become PDF coordinates.
 *
 * A PDF page is not a bitmap with its origin at the top left. Its origin can sit
 * anywhere (CropBox), its y-axis points up, and the whole page may carry a
 * /Rotate of 90, 180 or 270 that the viewer applies at display time. Hand-rolled
 * arithmetic that divides canvas pixels by a scale is right only for unrotated
 * pages whose box starts at (0,0) — which is most documents, and silently wrong
 * for the rest. Everything here goes through pdf.js's viewport transform, which
 * accounts for all three.
 */

export interface PdfPoint {
  x: number;
  y: number;
}

/** The slice of pdf.js's PageViewport this module needs — kept minimal for tests. */
export interface ViewportLike {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

/** The slice of a canvas the conversion needs — kept minimal for tests. */
export interface CanvasLike {
  width: number;
  height: number;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

/**
 * Mouse-event coordinates → canvas backing-store pixels.
 *
 * The canvas is often displayed smaller than its backing store (`max-w-full`),
 * so client pixels are scaled through the bounding rect first.
 */
export function clientToCanvasPoint(
  canvas: CanvasLike,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * canvas.width,
    y: ((clientY - rect.top) / rect.height) * canvas.height,
  };
}

/** Canvas/viewport pixels → PDF user space, via the full inverse transform. */
export function viewportToPdfPoint(viewport: ViewportLike, x: number, y: number): PdfPoint {
  const [px, py] = viewport.convertToPdfPoint(x, y);
  return { x: px, y: py };
}

/** PDF user space → canvas/viewport pixels. */
export function pdfToViewportPoint(
  viewport: ViewportLike,
  point: PdfPoint
): { x: number; y: number } {
  const [vx, vy] = viewport.convertToViewportPoint(point.x, point.y);
  return { x: vx, y: vy };
}

/**
 * The `rotate:` to pass to pdf-lib's drawText so the text reads upright on a
 * page carrying /Rotate.
 *
 * Verified empirically (pdf-lib draw → pdf.js extract → map the baseline through
 * the rotated viewport): the pre-rotation that cancels the viewer's rotation is
 * the page's own /Rotate angle. /Rotate 90 needs rotate 90; /Rotate 270 needs
 * 270; the sign-flipped variants come out mirrored. The regression test in
 * tests/geometry.test.ts re-runs that experiment.
 */
export function uprightTextRotation(pageRotationAngle: number): number {
  return ((pageRotationAngle % 360) + 360) % 360;
}
