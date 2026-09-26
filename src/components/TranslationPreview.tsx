'use client';
import { useEffect, useRef, useState } from 'react';
import { openPdf, renderPageToCanvas } from '@/lib/pdfjs';
export default function TranslationPreview({ bytes, page, label }: { bytes: Uint8Array; page: number; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    // Each render owns its canvas to avoid reuse while a cancelled task settles.
    const destination = canvas.current;
    const scratch = document.createElement('canvas');
    void (async () => {
      const pdf = await openPdf(bytes);
      try {
        controller.signal.throwIfAborted();
        setError(false);
        const p = await pdf.document.getPage(page);
        const view = p.getViewport({ scale: 1 });
        await renderPageToCanvas(p, scratch, Math.min(1.5, 1000 / view.width), { signal: controller.signal });
        if (destination && !controller.signal.aborted) {
          destination.width = scratch.width; destination.height = scratch.height;
          destination.getContext('2d')?.drawImage(scratch, 0, 0);
        }
      } finally { scratch.width = 0; scratch.height = 0; await pdf.destroy(); }
    })().catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [bytes, page]);
  return <figure><figcaption className="mb-2 text-sm font-medium">{label}</figcaption>
    {error && <p role="alert">{label}: preview unavailable / vista previa no disponible</p>}
    <canvas ref={canvas} aria-label={label} className="h-auto w-full rounded border bg-white" />
  </figure>;
}
