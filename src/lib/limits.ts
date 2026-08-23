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

/**
 * A higher ceiling for the tools that only read the page tree and write it back.
 *
 * Splitting, merging and reordering never turn a page into pixels: pdf-lib
 * holds the file's bytes and an object map over them, and an image stream stays
 * a byte range rather than becoming a bitmap. That costs roughly the file again,
 * not the twenty-fold blow-up rasterising causes — so a scanned book that the
 * general ceiling turns away is fine here.
 *
 * Measured on the engine rather than guessed: cutting a 700-page book into 700
 * separate PDFs took half a second in total.
 */
export const MAX_STRUCTURAL_BYTES = 400 * 1024 * 1024;

/**
 * What Studio will open, which is not the same question as what a tool will
 * process once.
 *
 * The 150 MB ceiling turned away an ordinary scanned textbook — 669 pages,
 * 169.5 MB — that the editor handles without complaint. Measured on that exact
 * file: pdf-lib parses it in 244 ms, a rotation rebuilds the whole document in
 * 397 ms, deleting a page 407 ms, and stamping a watermark across all 669 pages
 * 621 ms. None of that is near the 1500 ms at which the editor stops rebuilding
 * on its own.
 *
 * Memory is what actually binds. Peak resident memory for that file was 1.17 GB
 * — about seven times its size, because the bytes are held as the original, as
 * a parsed document, as the produced output and as pdf.js's own copy at once.
 * 250 MB projects to roughly 1.7 GB, which is the most a browser tab can be
 * asked to hold with any confidence, so that is where this sits.
 *
 * Bytes are a crude proxy and this comment should say so: cost tracks the
 * number of indirect objects, not the file size. That book holds just 3,049 of
 * them, because a scan is one large image per page — while a heavily tagged
 * document of a few megabytes can hold hundreds of thousands and cost far more.
 * The real defence is downstream: the editor times its own rebuilds and stops
 * doing them automatically when they get slow, which measures the thing itself
 * rather than guessing at it from a size.
 */
export const MAX_EDITABLE_BYTES = 250 * 1024 * 1024;

/** Pages rendered to pixels at once, which is what actually consumes memory. */
export const MAX_RENDERED_PAGES = 500;

/**
 * OCR is roughly a second per page, so this ceiling is about time, not memory.
 *
 * Raised from 100: a hundred pages is a chapter, and the tool was turning away
 * whole books. Five hundred pages is something like eight minutes, which is a
 * long wait but an honest one — the tool says so, shows progress and can be
 * cancelled. Being slow is the reader's call to make; being refused is not.
 */
export const MAX_OCR_PAGES = 500;

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

/**
 * A single message channel, reused: creating one per yield would be the
 * expensive part of something that has to be nearly free.
 */
let yieldChannel: MessageChannel | null = null;
const yieldQueue: Array<() => void> = [];

/**
 * Hands control back to the browser so it can paint and deliver a click.
 *
 * Deliberately not `setTimeout`. Browsers clamp nested timers to roughly one
 * second in a tab that is not in front, so a loop that yields once per page
 * then costs a second per page — measured on a 700-page book with the tab in
 * the background, it reached page six in forty-four seconds, on its way to well
 * over an hour. The same work with no yielding at all takes half a second.
 *
 * A message-channel task is a real macrotask, so input and painting still get
 * their turn, and nothing throttles it.
 */
export function yieldToBrowser(): Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!yieldChannel) {
    yieldChannel = new MessageChannel();
    yieldChannel.port1.onmessage = () => yieldQueue.shift()?.();
    yieldChannel.port1.start?.();
    // Node keeps a listening port referenced, which would hold a test runner
    // open after its last assertion. Browsers have no unref and need none.
    (yieldChannel.port1 as { unref?: () => void }).unref?.();
    (yieldChannel.port2 as { unref?: () => void }).unref?.();
  }
  const channel = yieldChannel;
  return new Promise((resolve) => {
    yieldQueue.push(resolve);
    channel.port2.postMessage(0);
  });
}
