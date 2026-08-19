'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import Navbar from '@/components/Navbar';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import { Download, FileText, Loader2, MousePointerClick, Trash2, Upload, X } from 'lucide-react';
import { describeError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob } from '@/lib/files';
import { assertFileSize } from '@/lib/limits';
import { openPdf, renderPageToCanvas } from '@/lib/pdfjs';

/** Preview scale. Annotation coordinates are stored in PDF points, not pixels. */
const PREVIEW_SCALE = 1.4;
const FONT_SIZE = 12;

interface Annotation {
  id: number;
  /** Position in PDF user space, measured from the bottom-left of the page. */
  x: number;
  y: number;
  text: string;
  pageIndex: number;
}

export default function EditPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isPlacingText, setIsPlacingText] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<ToolError | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** The original bytes, kept intact for pdf-lib — pdf.js gets its own copy. */
  const bytesRef = useRef<Uint8Array | null>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const destroyRef = useRef<(() => Promise<void>) | null>(null);
  const nextIdRef = useRef(1);

  useEffect(
    () => () => {
      void destroyRef.current?.();
    },
    []
  );

  const reset = useCallback(() => {
    void destroyRef.current?.();
    documentRef.current = null;
    destroyRef.current = null;
    bytesRef.current = null;
    setFile(null);
    setPageCount(0);
    setCanvasSize(null);
    setCurrentPage(1);
    setAnnotations([]);
    setIsPlacingText(false);
    setResult(null);
    setError(null);
  }, []);

  const selectFile = async (selected: File) => {
    reset();
    try {
      assertFileSize(selected);
      const bytes = new Uint8Array(await selected.arrayBuffer());
      // openPdf copies before handing the bytes to the worker, so this array stays
      // usable. Passing the same buffer to pdf.js detaches it, which is why saving
      // used to fail on a zero-length document.
      const source = await openPdf(bytes);

      bytesRef.current = bytes;
      documentRef.current = source.document;
      destroyRef.current = source.destroy;

      setFile(selected);
      setPageCount(source.document.numPages);
      setCurrentPage(1);
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  // Draw the current page onto the canvas the reader actually sees. The previous
  // version rendered to an off-screen canvas and threw the image away, leaving a
  // blank 300x150 box and no way to place any text at all.
  useEffect(() => {
    const document_ = documentRef.current;
    const canvas = canvasRef.current;
    if (!document_ || !canvas) return;

    let cancelled = false;
    setIsRendering(true);

    (async () => {
      try {
        const page = await document_.getPage(currentPage);
        if (cancelled) return;
        const size = await renderPageToCanvas(page, canvas, PREVIEW_SCALE);
        page.cleanup();
        if (!cancelled) setCanvasSize(size);
      } catch (caught) {
        if (!cancelled) setError(describeError(caught));
      } finally {
        if (!cancelled) setIsRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentPage, pageCount]);

  const placeAnnotation = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!isPlacingText || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    // The canvas is displayed at whatever width fits, so convert through its
    // rendered size rather than assuming pixels map one to one.
    const xInCanvas = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const yInCanvas = ((event.clientY - rect.top) / rect.height) * canvas.height;

    setAnnotations((previous) => [
      ...previous,
      {
        id: nextIdRef.current++,
        x: xInCanvas / PREVIEW_SCALE,
        y: (canvas.height - yInCanvas) / PREVIEW_SCALE,
        text: '',
        pageIndex: currentPage - 1,
      },
    ]);
    setIsPlacingText(false);
  };

  const save = async () => {
    const bytes = bytesRef.current;
    if (!bytes) return;

    const filled = annotations.filter((annotation) => annotation.text.trim() !== '');
    if (filled.length === 0) {
      setError({
        kind: 'unknown',
        title: 'Nothing to save yet',
        detail: 'Add some text to at least one of the boxes you placed, then save.',
      });
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const document_ = await PDFDocument.load(bytes);
      const font = await document_.embedFont(StandardFonts.Helvetica);
      const pages = document_.getPages();

      for (const annotation of filled) {
        const page = pages[annotation.pageIndex];
        if (!page) continue;
        page.drawText(annotation.text, {
          x: annotation.x,
          // drawText places the baseline; the click marked the top of the box.
          y: annotation.y - FONT_SIZE,
          size: FONT_SIZE,
          font,
          color: rgb(0, 0, 0),
        });
      }

      const saved = (await document_.save()).slice();
      setResult(new Blob([saved], { type: 'application/pdf' }));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setIsSaving(false);
    }
  };

  const pageAnnotations = annotations.filter(
    (annotation) => annotation.pageIndex === currentPage - 1
  );

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-12">
        <div className="mb-12 text-center">
          <h1 className="mb-4 text-4xl font-bold text-gray-900">Edit PDF</h1>
          <p className="text-gray-600">Add text anywhere on a page, then save a new copy.</p>
        </div>

        {!file ? (
          <div className="space-y-6">
            <FileDropzone
              inputId="edit-file-input"
              kind={PDF_FILES}
              onFilesSelected={([selected]) => void selectFile(selected)}
              className="cursor-pointer rounded-3xl border-2 border-dashed border-gray-300 bg-white p-12 text-center transition-all hover:border-blue-400"
            >
              <div className="flex flex-col items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <Upload className="h-8 w-8" />
                </div>
                <p className="text-lg font-semibold">Choose a PDF file</p>
                <p className="text-sm text-gray-500">or drop one here</p>
              </div>
            </FileDropzone>
            <ErrorNotice error={error} onDismiss={() => setError(null)} />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4">
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-6 w-6 shrink-0 text-purple-500" />
                <span className="truncate font-medium">{file.name}</span>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">
                  {pageCount} {pageCount === 1 ? 'page' : 'pages'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsPlacingText((value) => !value)}
                  aria-pressed={isPlacingText}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                    isPlacingText
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <MousePointerClick className="h-4 w-4" />
                  {isPlacingText ? 'Click the page…' : 'Add text'}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  aria-label="Close this file"
                  className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-red-500"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <ErrorNotice error={error} onDismiss={() => setError(null)} />

            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                  className="rounded-xl border bg-white px-4 py-2 disabled:opacity-30"
                >
                  Previous
                </button>
                <span className="font-medium tabular-nums">
                  Page {currentPage} of {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
                  disabled={currentPage === pageCount}
                  className="rounded-xl border bg-white px-4 py-2 disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            )}

            <div className="relative flex justify-center overflow-hidden rounded-3xl border bg-white p-4 shadow-sm">
              <div className="relative">
                <canvas
                  ref={canvasRef}
                  className="max-w-full"
                  onClick={placeAnnotation}
                  style={{ cursor: isPlacingText ? 'crosshair' : 'default' }}
                />

                {isRendering && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                  </div>
                )}

                {canvasSize &&
                  pageAnnotations.map((annotation) => (
                    <div
                      key={annotation.id}
                      className="absolute"
                      style={{
                        left: `${((annotation.x * PREVIEW_SCALE) / canvasSize.width) * 100}%`,
                        top: `${(1 - (annotation.y * PREVIEW_SCALE) / canvasSize.height) * 100}%`,
                      }}
                    >
                      <div className="flex -translate-y-1/2 items-center gap-1 rounded-lg border border-purple-300 bg-white shadow-sm">
                        <input
                          type="text"
                          value={annotation.text}
                          onChange={(event) =>
                            setAnnotations((previous) =>
                              previous.map((item) =>
                                item.id === annotation.id
                                  ? { ...item, text: event.target.value }
                                  : item
                              )
                            )
                          }
                          placeholder="Type here…"
                          aria-label="Annotation text"
                          className="w-40 rounded-l-lg border-0 px-2 py-1 text-sm outline-none"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setAnnotations((previous) =>
                              previous.filter((item) => item.id !== annotation.id)
                            )
                          }
                          aria-label="Remove this annotation"
                          className="p-1 text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {isPlacingText && (
              <p className="text-center text-sm font-medium text-purple-600">
                Click anywhere on the page to put a text box there.
              </p>
            )}

            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={save}
                disabled={isSaving || annotations.length === 0}
                className="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" /> Saving…
                  </>
                ) : (
                  'Save PDF'
                )}
              </button>
            </div>
          </div>
        )}

        {result && file && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
            <div className="max-w-md rounded-3xl border bg-white p-12 text-center shadow-xl">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-600">
                <FileText className="h-10 w-10" />
              </div>
              <h2 className="mb-2 text-2xl font-bold">Your edited PDF is ready</h2>
              <p className="mb-8 text-gray-600">
                {annotations.filter((annotation) => annotation.text.trim() !== '').length} text
                {annotations.filter((annotation) => annotation.text.trim() !== '').length === 1
                  ? ' box was'
                  : ' boxes were'}{' '}
                added.
              </p>
              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <button
                  type="button"
                  onClick={() => downloadBlob(result, derivedFileName(file.name, '_edited.pdf'))}
                  className="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-4 text-lg font-bold text-white hover:bg-blue-700"
                >
                  <Download className="h-5 w-5" /> Download
                </button>
                <button
                  type="button"
                  onClick={() => setResult(null)}
                  className="rounded-full bg-gray-100 px-8 py-4 text-lg font-bold text-gray-700 hover:bg-gray-200"
                >
                  Keep editing
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
