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

/* ------------------------------------------------------------------ *
 * Placement in pure PDF space
 *
 * Everything above needs a rendered page: it maps a click on a canvas.
 * Everything below works from the page itself — its box and its /Rotate — so
 * the code that writes a watermark or a page number never has to render
 * anything first. The two agree by construction, and tests/geometry.test.ts
 * checks that agreement against pdf.js for all four rotations.
 * ------------------------------------------------------------------ */

/** A page's visible area and its display rotation. */
export interface PageBox {
  /** Left edge of the crop box, in PDF user space. */
  x: number;
  /** Bottom edge of the crop box, in PDF user space. */
  y: number;
  width: number;
  height: number;
  /** /Rotate, any multiple of 90 (normalized on use). */
  rotation: number;
}

/** The slice of a pdf-lib PDFPage that placement needs. */
export interface PageLike {
  getCropBox(): { x: number; y: number; width: number; height: number };
  getRotation(): { angle: number };
}

export function normalizeAngle(angle: number): number {
  return ((Math.round(angle) % 360) + 360) % 360;
}

export function pageBoxOf(page: PageLike): PageBox {
  const box = page.getCropBox();
  return { ...box, rotation: normalizeAngle(page.getRotation().angle) };
}

/**
 * The page as the reader sees it. A quarter turn swaps width and height, which
 * is exactly the case hand-rolled placement code gets wrong.
 */
export function visualSize(box: PageBox): { width: number; height: number } {
  const quarterTurn = normalizeAngle(box.rotation) % 180 !== 0;
  return quarterTurn
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height };
}

/**
 * Visual coordinates — origin at the top-left of the page as displayed, y
 * pointing DOWN — to PDF user space. Same convention as pdf.js's
 * `viewport.convertToPdfPoint` at scale 1, and tested against it.
 */
export function visualToPdfPoint(box: PageBox, vx: number, vy: number): PdfPoint {
  switch (normalizeAngle(box.rotation)) {
    case 90:
      return { x: box.x + vy, y: box.y + vx };
    case 180:
      return { x: box.x + box.width - vx, y: box.y + vy };
    case 270:
      return { x: box.x + box.width - vy, y: box.y + box.height - vx };
    default:
      return { x: box.x + vx, y: box.y + box.height - vy };
  }
}

/**
 * Visual coordinates with the origin at the BOTTOM-left and y pointing UP.
 *
 * This is the frame a rotated page behaves like an unrotated one in, so it is
 * the frame the drawing code works in: pair it with `uprightTextRotation` and
 * pdf-lib's `drawText` behaves exactly as it would on a page with no /Rotate.
 */
export function visualUpToPdfPoint(box: PageBox, vx: number, vy: number): PdfPoint {
  return visualToPdfPoint(box, vx, visualSize(box).height - vy);
}

/** The nine places something can sit on a page. */
export type Anchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export const ANCHORS: readonly Anchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

/**
 * Where a block of `content` sits on the page, in the bottom-left/y-up visual
 * frame. Returns the block's bottom-left corner.
 *
 * The margin applies to the six edge anchors; a centred anchor ignores it on
 * that axis. A block larger than the page is clamped to the page rather than
 * pushed off it.
 */
export function anchorBlock(
  visual: { width: number; height: number },
  content: { width: number; height: number },
  anchor: Anchor,
  margin: number
): { x: number; y: number } {
  const [vertical, horizontal] = anchor.split('-');

  const x =
    horizontal === 'left'
      ? margin
      : horizontal === 'right'
        ? visual.width - content.width - margin
        : (visual.width - content.width) / 2;

  const y =
    vertical === 'bottom'
      ? margin
      : vertical === 'top'
        ? visual.height - content.height - margin
        : (visual.height - content.height) / 2;

  return {
    x: Math.min(Math.max(x, 0), Math.max(visual.width - content.width, 0)),
    y: Math.min(Math.max(y, 0), Math.max(visual.height - content.height, 0)),
  };
}

/**
 * Where to hand pdf-lib the origin of a block that should end up centred on
 * `target`, once pdf-lib rotates it by `angle` about that same origin.
 *
 * pdf-lib pivots `drawText` and `drawImage` about the point you give it, not
 * about the block's centre, so a watermark tilted 45° and asked for the middle
 * of the page would drift off it. Working out where the centre lands and
 * subtracting is what keeps a tilted stamp where the reader put it.
 */
export function originForRotatedCenter(
  target: { x: number; y: number },
  content: { width: number; height: number },
  angle: number
): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfWidth = content.width / 2;
  const halfHeight = content.height / 2;
  return {
    x: target.x - (halfWidth * cos - halfHeight * sin),
    y: target.y - (halfWidth * sin + halfHeight * cos),
  };
}

/**
 * The size at which an image fits inside a square box without changing shape.
 *
 * A stamp placed on a page used to be 140×140 points whatever the image was,
 * so a scanned signature of 600×200 pixels came out crushed into a square. The
 * longest side takes the box and the other follows the image's own ratio — the
 * same rule `materialize` applies to an image that becomes a whole page. An
 * image whose size is not known falls back to the square, which is what it was.
 */
export function fitWithin(
  width: number,
  height: number,
  box: number
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: box, height: box };
  const scale = box / Math.max(width, height);
  return { width: width * scale, height: height * scale };
}
