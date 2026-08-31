'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Loader2 } from 'lucide-react';
import { clientToCanvasPoint, viewportToPdfPoint } from '@/lib/geometry';
import { renderPageToCanvas } from '@/lib/pdfjs';
import { flattenTextRuns, type FlatTextRun } from '@/lib/studio/textReplacement';
import { detectPdfFonts, type EmbeddedPdfFontProgram } from '@/lib/studio/fonts';
import { groupTextParagraphs, type TextParagraph } from '@/lib/studio/paragraphs';

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

export type StageTool =
  | 'pick'
  | 'text'
  | 'rect'
  | 'image'
  | 'ink'
  | 'crop'
  | 'redact'
  | 'replaceText'
  | 'paragraph'
  | 'signature'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'comment'
  | 'erase'
  | 'line'
  | 'ellipse';

export type StageAction =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  /** Two points, in order. A rectangle would lose which way an arrow points. */
  | { kind: 'segment'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'path'; points: Array<[number, number]> };

export interface TextSelection {
  selected: FlatTextRun;
  /** All text on the same rendered page, used to rebuild its searchable layer. */
  runs: readonly FlatTextRun[];
}

export interface ParagraphSelection {
  selected: TextParagraph;
  /** All text on the same rendered page, used to rebuild its searchable layer. */
  runs: readonly FlatTextRun[];
}

interface StageProps {
  document: PDFDocumentProxy | null;
  embeddedFonts?: readonly EmbeddedPdfFontProgram[];
  /** Multiplier applied after the page is fitted into Studio's viewer. */
  zoom?: number;
  /** 0-based page of the materialised document. */
  pageIndex: number;
  tool: StageTool;
  busy: boolean;
  /** Called with coordinates in the page's PDF user space. */
  onAction: (action: StageAction, pageRotation: number) => void;
  selectedTextId?: string | null;
  onTextSelect?: (selection: TextSelection) => void;
  selectedParagraphId?: string | null;
  onParagraphSelect?: (selection: ParagraphSelection) => void;
  searchHighlights?: ReadonlyArray<{
    id: string;
    visual: FlatTextRun['visual'];
    active: boolean;
  }>;
}

const MAX_EDGE = 760;

/** A drag in progress, in canvas pixels, for the overlay only. */
type Drag =
  | { kind: 'rect'; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: 'path'; points: Array<{ x: number; y: number }> };

export default function Stage({
  document: pdf,
  embeddedFonts = [],
  zoom = 1,
  pageIndex,
  tool,
  busy,
  onAction,
  selectedTextId = null,
  onTextSelect,
  selectedParagraphId = null,
  onParagraphSelect,
  searchHighlights = [],
}: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<Awaited<ReturnType<typeof renderPageToCanvas>>['viewport'] | null>(
    null
  );
  const rotationRef = useRef(0);
  const strokeRotationRef = useRef(0);
  const [size, setSize] = useState<{ width: number; height: number; scale: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [rendering, setRendering] = useState(false);
  const [textRuns, setTextRuns] = useState<FlatTextRun[]>([]);
  const paragraphs = useMemo(() => groupTextParagraphs(textRuns), [textRuns]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    // Aborting this is what actually stops pdf.js. The flag alone left the
    // old render running on the canvas the new one needed.
    const controller = new AbortController();

    void (async () => {
      setRendering(true);
      try {
        const number = Math.min(Math.max(pageIndex + 1, 1), pdf.numPages);
        const page = await pdf.getPage(number);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(MAX_EDGE / base.width, MAX_EDGE / base.height, 2) * zoom;
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const rendered = await renderPageToCanvas(page, canvas, scale, {
          signal: controller.signal,
        });
        let content: Awaited<ReturnType<typeof page.getTextContent>> | null = null;
        if (tool === 'replaceText' || tool === 'paragraph') {
          try {
            content = await page.getTextContent();
          } catch {
            // A malformed text stream must not make an otherwise renderable
            // page disappear. It simply has no selectable replacement targets.
          }
        }
        const fonts = content ? detectPdfFonts(page, content.items, embeddedFonts) : new Map();
        rotationRef.current = page.rotate;
        page.cleanup();
        if (cancelled) return;

        viewportRef.current = rendered.viewport;
        setSize({ width: rendered.width, height: rendered.height, scale: rendered.viewport.scale });
        setTextRuns(content ? flattenTextRuns(content.items, rendered.viewport, fonts) : []);
      } catch {
        if (!cancelled) {
          setSize(null);
          setTextRuns([]);
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [pdf, pageIndex, tool, embeddedFonts, zoom]);

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
    if (tool === 'pick' || tool === 'replaceText' || tool === 'paragraph' || busy) return;
    const point = toCanvas(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'text' || tool === 'image' || tool === 'comment' || tool === 'signature') {
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

    if (tool === 'line') {
      // Measured along the line rather than by its box, so a horizontal drag
      // — height zero — is still a line and not a misfire.
      if (Math.hypot(b.x - a.x, b.y - a.y) < 3) return;
      onAction(
        { kind: 'segment', x1: a.x, y1: a.y, x2: b.x, y2: b.y },
        strokeRotationRef.current
      );
      return;
    }

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

  const cursor = busy || tool === 'pick' || tool === 'replaceText' || tool === 'paragraph' ? 'default' : 'crosshair';

  return (
    <div className="relative flex min-h-[30rem] items-start justify-center overflow-auto rounded-lg border bg-gray-100 p-4 sm:items-center">
      <div className="relative min-w-max">
        <canvas
          ref={canvasRef}
          className="rounded bg-white shadow-md"
          style={{ cursor, touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragRef.current = null;
            setDrag(null);
          }}
        />

        {tool === 'replaceText' && size && (
          <div className="pointer-events-none absolute inset-0">
            {textRuns.map((run) => {
              const scale = size.scale;
              const left = (run.visual.left * scale * 100) / size.width;
              const top = (run.visual.top * scale * 100) / size.height;
              const width = (run.visual.width * scale * 100) / size.width;
              const height = (run.visual.height * scale * 100) / size.height;
              const selected = run.id === selectedTextId;
              return (
                <button
                  key={run.id}
                  type="button"
                  disabled={busy}
                  aria-pressed={selected}
                  aria-label={run.text}
                  title={run.text}
                  onClick={() => onTextSelect?.({ selected: run, runs: textRuns })}
                  className={`pointer-events-auto absolute border-2 transition-colors disabled:pointer-events-none ${
                    selected
                      ? 'border-violet-700 bg-violet-300/35'
                      : 'border-transparent bg-cyan-300/10 hover:border-cyan-700 hover:bg-cyan-300/25'
                  }`}
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    width: `${Math.max(width, 0.5)}%`,
                    height: `${Math.max(height, 0.8)}%`,
                  }}
                />
              );
            })}
          </div>
        )}

        {tool === 'paragraph' && size && (
          <div className="pointer-events-none absolute inset-0">
            {paragraphs.map((paragraph) => {
              const scale = size.scale;
              const left = (paragraph.visual.left * scale * 100) / size.width;
              const top = (paragraph.visual.top * scale * 100) / size.height;
              const width = (paragraph.visual.width * scale * 100) / size.width;
              const height = (paragraph.visual.height * scale * 100) / size.height;
              const selected = paragraph.id === selectedParagraphId;
              const label = paragraph.text.replace(/\s+/g, ' ').trim();
              return (
                <button
                  key={paragraph.id}
                  type="button"
                  disabled={busy}
                  aria-pressed={selected}
                  aria-label={label}
                  title={label}
                  onClick={() => onParagraphSelect?.({ selected: paragraph, runs: textRuns })}
                  className={`pointer-events-auto absolute border-2 transition-colors disabled:pointer-events-none ${
                    selected
                      ? 'border-emerald-700 bg-emerald-300/30'
                      : 'border-transparent bg-emerald-300/10 hover:border-emerald-700 hover:bg-emerald-300/20'
                  }`}
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    width: `${Math.max(width, 0.5)}%`,
                    height: `${Math.max(height, 0.8)}%`,
                  }}
                />
              );
            })}
          </div>
        )}

        {size && searchHighlights.length > 0 && (
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            {searchHighlights.map((hit) => (
              <span
                key={hit.id}
                className={`absolute border-2 ${
                  hit.active
                    ? 'border-amber-700 bg-amber-300/45'
                    : 'border-amber-500 bg-amber-200/25'
                }`}
                style={{
                  left: `${(hit.visual.left * size.scale * 100) / size.width}%`,
                  top: `${(hit.visual.top * size.scale * 100) / size.height}%`,
                  width: `${Math.max((hit.visual.width * size.scale * 100) / size.width, 0.5)}%`,
                  height: `${Math.max((hit.visual.height * size.scale * 100) / size.height, 0.8)}%`,
                }}
              />
            ))}
          </div>
        )}

        {/* The shape being drawn, in canvas pixels, over the page. */}
        {pdf && size && drag && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${size.width} ${size.height}`}
            preserveAspectRatio="none"
          >
            {drag.kind === 'rect' ? (
              tool === 'line' ? (
                <line
                  x1={drag.from.x}
                  y1={drag.from.y}
                  x2={drag.to.x}
                  y2={drag.to.y}
                  stroke="rgb(37,99,235)"
                  strokeWidth={3}
                  strokeLinecap="round"
                />
              ) : tool === 'ellipse' ? (
                <ellipse
                  cx={(drag.from.x + drag.to.x) / 2}
                  cy={(drag.from.y + drag.to.y) / 2}
                  rx={Math.abs(drag.to.x - drag.from.x) / 2}
                  ry={Math.abs(drag.to.y - drag.from.y) / 2}
                  fill="rgba(59,130,246,0.15)"
                  stroke="rgb(37,99,235)"
                  strokeWidth={2}
                />
              ) : tool === 'underline' || tool === 'strikeout' ? (
                <line
                  x1={Math.min(drag.from.x, drag.to.x)}
                  x2={Math.max(drag.from.x, drag.to.x)}
                  y1={
                    tool === 'underline'
                      ? Math.max(drag.from.y, drag.to.y)
                      : (drag.from.y + drag.to.y) / 2
                  }
                  y2={
                    tool === 'underline'
                      ? Math.max(drag.from.y, drag.to.y)
                      : (drag.from.y + drag.to.y) / 2
                  }
                  stroke="rgb(220,38,38)"
                  strokeWidth={3}
                  strokeLinecap="round"
                />
              ) : (
                <rect
                  x={Math.min(drag.from.x, drag.to.x)}
                  y={Math.min(drag.from.y, drag.to.y)}
                  width={Math.abs(drag.to.x - drag.from.x)}
                  height={Math.abs(drag.to.y - drag.from.y)}
                  fill={tool === 'highlight' ? 'rgba(250,204,21,0.38)' : 'rgba(59,130,246,0.15)'}
                  stroke={tool === 'highlight' ? 'rgb(202,138,4)' : 'rgb(37,99,235)'}
                  strokeWidth={2}
                />
              )
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
