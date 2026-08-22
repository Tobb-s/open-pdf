'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Loader2 } from 'lucide-react';
import { clientToCanvasPoint, viewportToPdfPoint } from '@/lib/geometry';
import { renderPageToCanvas } from '@/lib/pdfjs';

/**
 * The page, drawn from the bytes the editor actually produced.
 *
 * Nothing here is a simulation of an edit: the document has already been
 * rebuilt by the worker, and this renders it. That is why a mistake shows up
 * while you are still editing rather than after you download.
 *
 * It also owns pointer input, because the only correct way to turn a click into
 * a position in the document is through the viewport that drew the pixels the
 * reader clicked on — rotation and crop box included.
 */

export type StageTool = 'pick' | 'text' | 'rect' | 'image' | 'ink' | 'crop' | 'redact';

export type StageAction =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'path'; points: Array<[number, number]> };

interface StageProps {
  document: PDFDocumentProxy | null;
  /** 0-based page of the materialised document. */
  pageIndex: number;
  tool: StageTool;
  busy: boolean;
  /** Called with coordinates in the page's PDF user space. */
  onAction: (action: StageAction, pageRotation: number) => void;
}

const MAX_EDGE = 760;

/** A drag in progress, in canvas pixels, for the overlay only. */
type Drag =
  | { kind: 'rect'; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: 'path'; points: Array<{ x: number; y: number }> };

export default function Stage({ document: pdf, pageIndex, tool, busy, onAction }: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<Awaited<ReturnType<typeof renderPageToCanvas>>['viewport'] | null>(
    null
  );
  const rotationRef = useRef(0);
  const strokeRotationRef = useRef(0);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;

    void (async () => {
      setRendering(true);
      try {
        const number = Math.min(Math.max(pageIndex + 1, 1), pdf.numPages);
        const page = await pdf.getPage(number);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(MAX_EDGE / base.width, MAX_EDGE / base.height, 2);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const rendered = await renderPageToCanvas(page, canvas, scale);
        rotationRef.current = page.rotate;
        page.cleanup();
        if (cancelled) return;

        viewportRef.current = rendered.viewport;
        setSize({ width: rendered.width, height: rendered.height });
      } catch {
        if (!cancelled) setSize(null);
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdf, pageIndex]);

  const toCanvas = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return clientToCanvasPoint(canvas, event.clientX, event.clientY);
  };

  /**
   * The viewport a stroke started under, held for as long as the stroke lasts.
   *
   * A rebuild landing mid-drag replaces `viewportRef`, and converting the
   * points a reader already drew through a viewport that did not exist when
   * they drew them puts the mark somewhere they never touched. A gesture is
   * measured against the page it was made on.
   */
  const strokeViewportRef = useRef<typeof viewportRef.current>(null);

  /**
   * The gesture in progress. It lives in a ref because pointer events can
   * arrive faster than React re-renders, and a handler reading a render-old
   * `drag` would collapse a stroke to its first point or leave a rectangle with
   * no width. The state below is a copy, and exists only to draw the guide.
   */
  const dragRef = useRef<Drag | null>(null);

  const toPdf = (point: { x: number; y: number }, pinned = false) => {
    const viewport = pinned ? strokeViewportRef.current : viewportRef.current;
    if (!viewport) return null;
    return viewportToPdfPoint(viewport, point.x, point.y);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'pick' || busy) return;
    const point = toCanvas(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'text' || tool === 'image') {
      const pdfPoint = toPdf(point);
      if (pdfPoint) onAction({ kind: 'point', ...pdfPoint }, rotationRef.current);
      return;
    }
    strokeViewportRef.current = viewportRef.current;
    strokeRotationRef.current = rotationRef.current;

    const started: Drag =
      tool === 'ink'
        ? { kind: 'path', points: [point] }
        : { kind: 'rect', from: point, to: point };
    dragRef.current = started;
    setDrag(started);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = dragRef.current;
    if (!current) return;
    const point = toCanvas(event);
    if (!point) return;

    const next: Drag =
      current.kind === 'rect'
        ? { ...current, to: point }
        : { kind: 'path', points: [...current.points, point] };
    dragRef.current = next;
    setDrag(next);
  };

  const onPointerUp = () => {
    const stroke = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!stroke) return;

    if (stroke.kind === 'path') {
      const points = stroke.points
        .map((point) => toPdf(point, true))
        .filter((point): point is { x: number; y: number } => point !== null)
        .map((point) => [point.x, point.y] as [number, number]);
      if (points.length > 0) onAction({ kind: 'path', points }, strokeRotationRef.current);
      return;
    }

    const a = toPdf(stroke.from, true);
    const b = toPdf(stroke.to, true);
    if (!a || !b) return;
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);
    // A stray click is not a rectangle; below a few points it is almost always
    // a misfire and drawing it would leave an invisible mark in the script.
    if (width < 3 || height < 3) return;
    onAction(
      { kind: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width, height },
      strokeRotationRef.current
    );
  };

  const cursor =
    busy || tool === 'pick' ? 'default' : tool === 'ink' ? 'crosshair' : 'crosshair';

  return (
    <div className="relative flex min-h-[24rem] items-center justify-center overflow-auto rounded-3xl border bg-gray-100 p-4">
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="max-w-full rounded bg-white shadow-md"
          style={{ cursor, touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragRef.current = null;
            setDrag(null);
          }}
        />

        {/* The shape being drawn, in canvas pixels, over the page. */}
        {pdf && size && drag && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${size.width} ${size.height}`}
            preserveAspectRatio="none"
          >
            {drag.kind === 'rect' ? (
              <rect
                x={Math.min(drag.from.x, drag.to.x)}
                y={Math.min(drag.from.y, drag.to.y)}
                width={Math.abs(drag.to.x - drag.from.x)}
                height={Math.abs(drag.to.y - drag.from.y)}
                fill="rgba(59,130,246,0.15)"
                stroke="rgb(37,99,235)"
                strokeWidth={2}
              />
            ) : (
              <polyline
                points={drag.points.map((point) => `${point.x},${point.y}`).join(' ')}
                fill="none"
                stroke="rgb(37,99,235)"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
        )}

        {(rendering || busy) && (
          <div className="absolute inset-0 flex items-center justify-center rounded bg-white/50">
            <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
          </div>
        )}
      </div>
    </div>
  );
}
