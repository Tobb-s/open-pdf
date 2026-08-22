'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ArrowLeft, ArrowRight, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { renderPageToJpeg } from '@/lib/pdfjs';

/**
 * The page rail: thumbnails of the document as it currently stands, with the
 * operations that act on a whole page.
 *
 * Each thumbnail is cached against a signature of the page it shows, so turning
 * one page costs one render rather than a whole rail. That is not a
 * micro-optimisation: measured on a six-page document, redrawing every
 * thumbnail after every edit took 23 seconds, which made the rail useless
 * exactly when the reader was working fastest. With the cache, an edit that
 * touches one page redraws one page.
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
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  /** Object URLs by page signature, shared across renders. */
  const cacheRef = useRef(new Map<string, string>());

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  const key = signatures.join('~');

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;

    void (async () => {
      const cache = cacheRef.current;
      const wanted = signatures.slice(0, pdf.numPages);
      const urls: string[] = [];

      try {
        for (const [index, signature] of wanted.entries()) {
          if (cancelled) return;

          const cached = cache.get(signature);
          if (cached) {
            urls.push(cached);
            continue;
          }

          const page = await pdf.getPage(index + 1);
          const { blob } = await renderPageToJpeg(page, THUMBNAIL_SCALE, 0.6);
          page.cleanup();
          if (cancelled) return;

          const url = URL.createObjectURL(blob);
          cache.set(signature, url);
          urls.push(url);
          // Shown as they arrive: on a long document the rail fills in rather
          // than staying blank until the last page is done.
          setThumbnails([...urls]);
        }

        if (cancelled) return;
        setThumbnails(urls);

        // Anything no page claims any more is a page that was deleted or edited
        // away; its bitmap is dead weight.
        const live = new Set(wanted);
        for (const [signature, url] of cache) {
          if (!live.has(signature)) {
            URL.revokeObjectURL(url);
            cache.delete(signature);
          }
        }
      } catch {
        // A rail that fails to draw is a cosmetic loss; the editor keeps working.
      }
    })();

    return () => {
      cancelled = true;
    };
    // `key` collapses the signature array into one comparable value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, key]);

  const total = thumbnails.length;

  return (
    <ul className="flex gap-3 overflow-x-auto pb-2">
      {thumbnails.map((url, index) => (
        <li key={`${index}-${url}`} className="shrink-0">
          <button
            type="button"
            onClick={() => onSelect(index)}
            aria-current={index === current}
            className={`block overflow-hidden rounded-xl border-2 bg-white transition-colors ${
              index === current ? 'border-violet-500' : 'border-transparent hover:border-violet-200'
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL */}
            <img src={url} alt={t.studio.pageOf(index + 1, total)} className="h-28 w-auto" />
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
      ))}
    </ul>
  );
}
