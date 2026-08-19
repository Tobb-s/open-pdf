import { KnownToolError } from '@/lib/errors';
import { formatBytes } from '@/lib/files';

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

export function assertFileSize(file: File, limit = MAX_FILE_BYTES): void {
  if (file.size <= limit) return;
  throw new KnownToolError(
    'too-large',
    `${file.name} is too large`,
    `This tool works on files up to ${formatBytes(limit)}; this one is ${formatBytes(file.size)}. Split it into smaller documents and try again.`
  );
}

export function assertPageCount(pageCount: number, limit: number, what: string): void {
  if (pageCount <= limit) return;
  throw new KnownToolError(
    'too-large',
    `This document has too many pages for ${what}`,
    `${pageCount} pages exceeds the limit of ${limit}. Use Split PDF to break it into parts first.`
  );
}

export const CANCELLED = new KnownToolError(
  'cancelled',
  'Cancelled',
  'The operation was stopped before it finished.'
);

/** Call at the top of each iteration of a long loop. */
export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw CANCELLED;
}

/** Lets the browser paint the progress bar between heavy iterations. */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
