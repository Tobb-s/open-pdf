'use client';

import { useEffect, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { loadPdf, savePdf } from '@/lib/pdfio';
import { openPdf, renderPageToCanvas } from '@/lib/pdfjs';

/** Longest edge of the preview, in CSS pixels before the browser scales it down. */
const PREVIEW_EDGE = 520;
/** Long enough that dragging a slider does not queue a render per pixel. */
const SETTLE_MS = 220;

interface StampPreviewProps {
  /** The document being edited, or null while nothing is loaded. */
  bytes: Uint8Array | null;
  /** Which page of that document to show, 1-based. */
  pageNumber: number;
  /**
   * Changes whenever the options change. The effect watches this rather than
   * the callback, which is a new function on every render.
   */
  signature: string;
  /** Applies the tool's own drawing to a one-page document. */
  apply: (document: PDFDocument) => Promise<void>;
}

/**
 * The page as it will actually come out.
 *
 * The preview is not a CSS approximation of a watermark: the page is extracted,
 * the real drawing code runs on it, and the result is rendered. So whatever the
 * reader sees here is what the file will contain — which is the only kind of
 * preview this project is willing to show.
 */
export default function StampPreview({ bytes, pageNumber, signature, apply }: StampPreviewProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const applyRef = useRef(apply);

  // Written after the render rather than during it, so the debounced job that
  // reads it always sees the newest options.
  useEffect(() => {
    applyRef.current = apply;
  });

  const [state, setState] = useState<'working' | 'ready' | 'failed'>('working');

  useEffect(() => {
    if (!bytes) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setState('working');
        try {
          const source = await loadPdf(bytes, { updateMetadata: false });
          const single = await PDFDocument.create();
          // copyPages carries the page's box, its /Rotate and its content, which
          // is everything the placement depends on. What it drops — the
          // catalogue — does not exist in a preview anyway.
          const [copied] = await single.copyPages(source, [pageNumber - 1]);
          single.addPage(copied);

          await applyRef.current(single);
          const out = await savePdf(single);
          if (cancelled) return;

          const opened = await openPdf(out);
          try {
            const page = await opened.document.getPage(1);
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(PREVIEW_EDGE / base.width, PREVIEW_EDGE / base.height, 2);
            const canvas = canvasRef.current;
            if (canvas && !cancelled) await renderPageToCanvas(page, canvas, scale);
            page.cleanup();
          } finally {
            await opened.destroy().catch(() => {});
          }

          if (!cancelled) setState('ready');
        } catch {
          // A preview that cannot be built is not a reason to block the tool —
          // the panel says so and the Apply button keeps working.
          if (!cancelled) setState('failed');
        }
      })();
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bytes, pageNumber, signature]);

  const shown = bytes ? state : 'idle';

  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">{t.stamp.preview}</h2>
        <p className="truncate text-xs text-gray-500">{t.stamp.previewPage(pageNumber)}</p>
      </div>

      <div className="relative flex min-h-[16rem] items-center justify-center overflow-hidden rounded-2xl border bg-gray-50 p-3">
        {/* Kept mounted while a new render is prepared, so adjusting a slider
            dims the old page rather than blanking the panel. */}
        <canvas
          ref={canvasRef}
          className={`max-h-[32rem] max-w-full rounded shadow-sm transition-opacity ${
            shown === 'working' ? 'opacity-40' : 'opacity-100'
          }`}
          style={{ display: shown === 'failed' || shown === 'idle' ? 'none' : 'block' }}
        />

        {shown === 'working' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-gray-500">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            {t.stamp.previewWorking}
          </div>
        )}

        {shown === 'failed' && (
          <p className="max-w-xs text-center text-sm text-gray-500">{t.stamp.previewFailed}</p>
        )}
      </div>

      {/* pdf.js draws on requestAnimationFrame, which a hidden tab never fires. */}
      <p className="mt-3 text-xs text-gray-400">{t.common.keepTabVisible}</p>
    </div>
  );
}
