import { KnownToolError } from '@/lib/errors';
import { formatBytes } from '@/lib/files';
import type { Dictionary } from '@/lib/i18n/dictionaries';

/**
 * Ceilings that keep a tool from taking the browser tab down with it.
 *
 * These are deliberately generous — the point is to fail with an explanation
 * instead of freezing, not to police ordinary documents.
 */
export const MAX_FILE_BYTES = 150 * 1024 * 1024;

/** Pages rendered to pixels at once, which is what actually consumes memory. */
export const MAX_RENDERED_PAGES = 500;

/** OCR is roughly a second per page, so the ceiling is lower and time-based. */
export const MAX_OCR_PAGES = 100;

/**
 * How much converted PDF a single batch may hold before it stops.
 *
 * Every document's PDF stays in memory until the batch finishes, and the join
 * or the zip then needs room for the whole thing again. Being slow is fine;
 * running the tab out of memory halfway through and losing the lot is not, so
 * the batch stops cleanly and hands over what it already has.
 */
export const MAX_BATCH_OUTPUT_BYTES = 300 * 1024 * 1024;

export type LimitLabel = keyof Dictionary['errors']['limitLabels'];

export function assertFileSize(file: File, t: Dictionary, limit = MAX_FILE_BYTES): void {
  if (file.size <= limit) return;
  throw new KnownToolError(
    'too-large',
    t.errors.tooLargeTitle(file.name),
    t.errors.tooLargeBody(formatBytes(limit), formatBytes(file.size))
  );
}

export function assertPageCount(
  pageCount: number,
  limit: number,
  what: LimitLabel,
  t: Dictionary
): void {
  if (pageCount <= limit) return;
  throw new KnownToolError(
    'too-large',
    t.errors.tooManyPagesTitle(t.errors.limitLabels[what]),
    t.errors.tooManyPagesBody(pageCount, limit)
  );
}

export function cancelled(t: Dictionary): KnownToolError {
  return new KnownToolError('cancelled', t.errors.cancelledTitle, t.errors.cancelledBody);
}

/** Call at the top of each iteration of a long loop. */
export function throwIfCancelled(signal: AbortSignal | undefined, t: Dictionary): void {
  if (signal?.aborted) throw cancelled(t);
}

/** Lets the browser paint the progress bar between heavy iterations. */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
