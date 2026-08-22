'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ArrowLeft, ArrowRight, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { renderPageToJpeg } from '@/lib/pdfjs';

/**
 * The page rail: the document as it currently stands, with the operations that
 * act on a whole page.
 *
 * Two things keep it usable on a real document rather than on a test fixture.
 *
 * A thumbnail is cached against a signature of the page it shows, so turning one
 * page costs one render rather than a whole rail — measured on six pages,
 * redrawing everything after every edit took 23 seconds.
 *
 * And a page is only drawn once it comes into view. A forty-five page lecture
 * deck showed about ten of its pages at a time and took thirty-five seconds to
 * fill the rest, all of it off screen. Now the visible ones arrive at once and
 * the rest when they are scrolled to.
 *
 * The main view, not this rail, is the one that promises to show the produced
 * bytes. A cached thumbnail can lag behind a mark drawn on its page until that
 * page's signature changes — the trade is deliberate, and the rail exists to
 * navigate and reorder rather than to prove anything.
 */

interface PageStripProps {
  document: PDFDocumentProxy | null;
  /**
   * One entry per page, in order: a string that changes whenever that page's
   * appearance should change. Pages whose signature is unchanged keep the
   * thumbnail they already have.
   */
  signatures: readonly string[];
  current: number;
  onSelect: (index: number) => void;
  onRotate: (index: number, turns: number) => void;
  onDelete: (index: number) => void;
  onMove: (index: number, to: number) => void;
  disabled: boolean;
}

const THUMBNAIL_SCALE = 0.22;
/** Start drawing a page this many pixels before it is scrolled into view. */
const LOOKAHEAD = 600;

export default function PageStrip({
  document: pdf,
  signatures,
  current,
  onSelect,
  onRotate,
  onDelete,
  onMove,
  disabled,
}: PageStripProps) {
  const { t } = useI18n();

  /**
   * Object URLs by page signature.
   *
   * In state because the markup reads it, and mirrored into a ref because the
   * drawing loop runs outside React and needs to know what is already there.
   */
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const cacheRef = useRef<Record<string, string>>({});
  /** Signatures asked for but not yet drawn. */
  const wantedRef = useRef(new Set<string>());
  const drawingRef = useRef(false);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    cacheRef.current = thumbnails;
  }, [thumbnails]);

  useEffect(() => {
    pdfRef.current = pdf;
  }, [pdf]);

  useEffect(
    () => () => {
      // Read at teardown, not at mount. Every write rebinds the ref to a fresh
      // object, so a reference captured when the effect ran would be the empty
      // one it started with — and every thumbnail would leak for the lifetime
      // of the tab.
      for (const url of Object.values(cacheRef.current)) URL.revokeObjectURL(url);
    },
    []
  );

  // Signatures no page claims any more belonged to a page that was deleted or
  // edited away; their bitmaps are dead weight.
  const key = signatures.join('~');
  useEffect(() => {
    const live = new Set(signatures);
    // After the commit rather than during it: dropping a handful of dead
    // bitmaps is housekeeping, and doing it synchronously here would make every
    // edit render the rail twice.
    queueMicrotask(() => {
      setThumbnails((current) => {
        const stale = Object.keys(current).filter((signature) => !live.has(signature));
        if (stale.length === 0) return current;
        const next = { ...current };
        for (const signature of stale) {
          URL.revokeObjectURL(next[signature]);
          delete next[signature];
        }
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /**
   * Draws whatever has been asked for, one page at a time. pdf.js serves every
   * render from a single worker, so queueing here rather than firing forty-five
   * requests at once is what lets the visible pages arrive first.
   */
  const drain = useCallback(async () => {
    if (drawingRef.current) return;
    drawingRef.current = true;
    try {
      for (;;) {
        const document_ = pdfRef.current;
        const [signature] = wantedRef.current;
        if (!document_ || signature === undefined) break;
        wantedRef.current.delete(signature);

        const index = signatures.indexOf(signature);
        if (index === -1 || index >= document_.numPages) continue;
        if (cacheRef.current[signature]) continue;

        try {
          const page = await document_.getPage(index + 1);
          const { blob } = await renderPageToJpeg(page, THUMBNAIL_SCALE, 0.6);
          page.cleanup();
          // The document can be replaced while a page is being drawn; a bitmap
          // from the old one must not be filed under the new one's key.
          if (pdfRef.current !== document_) continue;
          const url = URL.createObjectURL(blob);
          cacheRef.current = { ...cacheRef.current, [signature]: url };
          setThumbnails(cacheRef.current);
        } catch {
          // One page that will not draw is a gap in the rail, not a broken editor.
        }
      }
    } finally {
      drawingRef.current = false;
    }
  }, [signatures]);

  const request = useCallback(
    (signature: string) => {
      if (cacheRef.current[signature] || wantedRef.current.has(signature)) return;
      wantedRef.current.add(signature);
      void drain();
    },
    [drain]
  );

  /**
   * Which pages are worth drawing: the ones in view, plus a little either side.
   *
   * Read from the scroll position rather than from an IntersectionObserver.
   * The observer needs the page to be composited, and a rail in a tab that is
   * not being painted never received a single callback — so no thumbnail was
   * ever drawn at all. Layout is available whether or not anything is on
   * screen, so this asks layout.
   */
  const listRef = useRef<HTMLUListElement>(null);
  const requestVisible = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const from = list.scrollLeft - LOOKAHEAD;
    const to = list.scrollLeft + list.clientWidth + LOOKAHEAD;

    for (const item of list.children) {
      const element = item as HTMLElement;
      const left = element.offsetLeft;
      if (left + element.offsetWidth < from || left > to) continue;
      const signature = element.dataset.signature;
      if (signature) request(signature);
    }
  }, [request]);

  useEffect(() => {
    if (!pdf) return;
    requestVisible();
    const list = listRef.current;
    if (!list) return;
    list.addEventListener('scroll', requestVisible, { passive: true });
    return () => list.removeEventListener('scroll', requestVisible);
  }, [pdf, key, requestVisible]);

  const total = signatures.length;

  return (
    <ul ref={listRef} className="flex gap-3 overflow-x-auto pb-2">
      {signatures.map((signature, index) => {
        const url = thumbnails[signature];
        return (
          <li key={`${index}-${signature}`} data-signature={signature} className="shrink-0">
            <button
              type="button"
              onClick={() => onSelect(index)}
              aria-current={index === current}
              className={`block overflow-hidden rounded-xl border-2 bg-white transition-colors ${
                index === current
                  ? 'border-violet-500'
                  : 'border-transparent hover:border-violet-200'
              }`}
            >
              {url ? (
                /* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL */
                <img src={url} alt={t.studio.pageOf(index + 1, total)} className="h-28 w-auto" />
              ) : (
                <div
                  className="flex h-28 w-20 items-center justify-center bg-gray-100 text-xs tabular-nums text-gray-400"
                  aria-label={t.studio.pageOf(index + 1, total)}
                >
                  {index + 1}
                </div>
              )}
            </button>

            <div className="mt-1 flex items-center justify-center gap-0.5">
              <button
                type="button"
                disabled={disabled || index === 0}
                onClick={() => onMove(index, index - 1)}
                aria-label={t.studio.moveEarlier}
                title={t.studio.moveEarlier}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-violet-600 disabled:opacity-30"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRotate(index, -1)}
                aria-label={t.studio.rotateLeft}
                title={t.studio.rotateLeft}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-violet-600 disabled:opacity-30"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRotate(index, 1)}
                aria-label={t.studio.rotateRight}
                title={t.studio.rotateRight}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-violet-600 disabled:opacity-30"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={disabled || total <= 1}
                onClick={() => onDelete(index)}
                aria-label={t.studio.deletePage}
                title={total <= 1 ? t.studio.lastPage : t.studio.deletePage}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500 disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={disabled || index === total - 1}
                onClick={() => onMove(index, index + 1)}
                aria-label={t.studio.moveLater}
                title={t.studio.moveLater}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-violet-600 disabled:opacity-30"
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
