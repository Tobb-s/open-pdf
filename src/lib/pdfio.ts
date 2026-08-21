import { PDFDocument, ParseSpeeds } from 'pdf-lib';

type LoadOptions = NonNullable<Parameters<typeof PDFDocument.load>[1]>;
type SaveOptions = NonNullable<Parameters<PDFDocument['save']>[0]>;

/**
 * pdf-lib's load and save yield to the event loop with `setTimeout(0)` every 100
 * and 50 objects respectively, and browsers clamp those nested timeouts to ~4 ms.
 * Measured here on a 200-page document: 246 ms with the defaults, 12 ms without —
 * the "work" was 87–95% timer.
 *
 * Turning the ticks off also removes the failure where a backgrounded tab has its
 * timers throttled to once a second and a save stretches into minutes.
 *
 * The cost is that load and save now block for their real duration. That real
 * duration is tens of milliseconds for ordinary documents; callers that process
 * something enormous already sit behind a progress panel.
 */
export function loadPdf(
  bytes: Uint8Array | ArrayBuffer,
  options: LoadOptions = {}
): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { parseSpeed: ParseSpeeds.Fastest, ...options });
}

export function savePdf(document: PDFDocument, options: SaveOptions = {}): Promise<Uint8Array> {
  return document.save({ objectsPerTick: Number.POSITIVE_INFINITY, ...options });
}
