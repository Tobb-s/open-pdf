'use client';

import { useEffect, useRef, useState } from 'react';
import Navbar from '@/components/Navbar';
import ResultHeading from '@/components/ResultHeading';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import ProgressPanel from '@/components/ProgressPanel';
import {
  ArrowLeft,
  ArrowRight,
  Download,
  FileText,
  GripVertical,
  Loader2,
  RotateCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { describeError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob } from '@/lib/files';
import {
  assertFileSize,
  assertPageCount,
  MAX_RENDERED_PAGES,
  throwIfCancelled,
} from '@/lib/limits';
import { openPdf, renderPageToJpeg } from '@/lib/pdfjs';
import { applyPageEdits } from '@/lib/pageEdits';
import { reportStructures, type StructuralReport } from '@/lib/verify/structural';

interface OrganizedPage {
  id: string;
  sourceIndex: number;
  pageNumber: number;
  previewUrl: string;
  /** Extra rotation the reader applied, in degrees clockwise. */
  rotation: number;
  /** Aspect ratio of the rendered thumbnail, used to scale rotated previews. */
  aspect: number;
}

const THUMBNAIL_SCALE = 0.3;

export default function OrganizePage() {
  const { locale, t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<OrganizedPage[]>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadMessage, setLoadMessage] = useState('');
  const [loadPercent, setLoadPercent] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<Blob | null>(null);
  const [report, setReport] = useState<StructuralReport | null>(null);
  const [error, setError] = useState<ToolError | null>(null);

  const listFormat = (items: string[]) =>
    new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);

  const bytesRef = useRef<Uint8Array | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pagesRef = useRef<OrganizedPage[]>([]);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(
    () => () => {
      for (const page of pagesRef.current) URL.revokeObjectURL(page.previewUrl);
    },
    []
  );

  const reset = () => {
    for (const page of pagesRef.current) URL.revokeObjectURL(page.previewUrl);
    bytesRef.current = null;
    setFile(null);
    setPages([]);
    setDraggedId(null);
    setResult(null);
    setReport(null);
    setError(null);
    setLoadPercent(0);
  };

  const selectFile = async (selected: File) => {
    reset();
    setFile(selected);
    setIsLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let source: Awaited<ReturnType<typeof openPdf>> | null = null;
    const built: OrganizedPage[] = [];

    try {
      assertFileSize(selected, t);
      const bytes = new Uint8Array(await selected.arrayBuffer());
      bytesRef.current = bytes;

      source = await openPdf(bytes);
      const pageCount = source.document.numPages;
      assertPageCount(pageCount, MAX_RENDERED_PAGES, 'previews', t);

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        throwIfCancelled(controller.signal, t);
        setLoadPercent((pageNumber / pageCount) * 100);
        setLoadMessage(t.organize.renderingPage(pageNumber, pageCount));

        const page = await source.document.getPage(pageNumber);
        // JPEG object URLs rather than PNG data URLs: a data URL keeps the whole
        // image alive as a base64 string in React state, which is what made long
        // documents unusable here.
        const { blob, width, height } = await renderPageToJpeg(page, THUMBNAIL_SCALE, 0.7);
        page.cleanup();

        built.push({
          id: `page-${pageNumber}`,
          sourceIndex: pageNumber - 1,
          pageNumber,
          previewUrl: URL.createObjectURL(blob),
          rotation: 0,
          aspect: width / height,
        });
      }

      setPages(built);
    } catch (caught) {
      for (const page of built) URL.revokeObjectURL(page.previewUrl);
      const described = describeError(caught, t);
      if (described.kind !== 'cancelled') setError(described);
      setFile(null);
    } finally {
      abortRef.current = null;
      await source?.destroy().catch(() => {});
      setIsLoading(false);
    }
  };

  const movePage = (from: number, to: number) => {
    setPages((previous) => {
      if (to < 0 || to >= previous.length || from === to) return previous;
      const next = [...previous];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const save = async () => {
    const bytes = bytesRef.current;
    if (!bytes || pages.length === 0) return;

    setIsProcessing(true);
    setError(null);

    try {
      // The output IS the input, mutated in place. Rebuilding the document with
      // copyPages into a fresh one was measured to strip its form fields,
      // bookmarks, attachments, language and title — the reader asked to change
      // the page order, not to lose everything the pages hang from.
      const saved = await applyPageEdits(
        bytes,
        pages.map((page) => ({ sourceIndex: page.sourceIndex, rotation: page.rotation }))
      );

      // Read the claim back out of the produced bytes, never assume it.
      setReport(await reportStructures(bytes, saved));
      setResult(new Blob([saved as unknown as BlobPart], { type: 'application/pdf' }));
    } catch (caught) {
      setError(describeError(caught, t));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-12 text-center">
          <h1 className="mb-4 text-4xl font-bold text-gray-900">{t.organize.heading}</h1>
          <p className="text-gray-600">
            {t.organize.intro}
          </p>
        </div>

        {!file ? (
          <div className="space-y-6">
            <FileDropzone
              inputId="organize-file-input"
              kind={PDF_FILES}
              onFilesSelected={([selected]) => void selectFile(selected)}
              className="cursor-pointer rounded-3xl border-2 border-dashed border-gray-300 bg-white p-12 text-center transition-all hover:border-blue-400"
            >
              <div className="flex flex-col items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <Upload className="h-8 w-8" />
                </div>
                <div>
                  <p className="text-lg font-semibold">{t.common.choosePdf}</p>
                  <p className="text-sm text-gray-500">{t.common.orDropIt}</p>
                </div>
              </div>
            </FileDropzone>
            <ErrorNotice error={error} onDismiss={() => setError(null)} />
          </div>
        ) : result ? (
          <div className="rounded-3xl border bg-white p-12 text-center shadow-sm">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-600">
              <FileText className="h-10 w-10" />
            </div>
            <ResultHeading className="mb-2 text-2xl font-bold">
              {t.organize.doneTitle(pages.length)}
            </ResultHeading>
            <p className="mb-4 text-gray-600">{t.organize.doneBody}</p>

            {report?.signatureBroken && (
              /* A fact about the operation, not an entry in either list below:
                 nothing went missing — the signature dictionary comes through
                 intact — and the signature is dead all the same, because the
                 bytes its digest described are gone. */
              <p className="mx-auto mb-4 max-w-lg rounded-2xl border border-red-200 bg-red-50 p-4 text-left text-sm text-red-900">
                {t.common.signatureBroken}
              </p>
            )}

            {report && report.losses.length > 0 ? (
              <div className="mx-auto mb-8 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">
                {t.organize.lostNote(
                  listFormat(report.losses.map((loss) => t.structures[loss.category]))
                )}
              </div>
            ) : report && report.present.length > 0 ? (
              <p className="mb-8 text-sm text-gray-500">
                {t.organize.keptNote(
                  listFormat(report.present.map((category) => t.structures[category]))
                )}
              </p>
            ) : (
              <div className="mb-8" />
            )}

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <button
                type="button"
                onClick={() => downloadBlob(result, derivedFileName(file.name, '_organized.pdf'))}
                className="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700"
              >
                <Download className="h-5 w-5" />
                {t.common.download}
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-full bg-gray-100 px-8 py-4 text-lg font-bold text-gray-700 transition-all hover:bg-gray-200"
              >
                {t.organize.another}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between rounded-2xl border bg-white p-4">
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-6 w-6 shrink-0 text-blue-500" />
                <span className="truncate font-medium">{file.name}</span>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">
                  {pages.length} {pages.length === 1 ? t.common.page : t.common.pages}
                </span>
              </div>
              <button
                type="button"
                onClick={reset}
                aria-label={t.common.removeFile}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-red-500"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <ErrorNotice error={error} onDismiss={() => setError(null)} />

            {isLoading ? (
              <ProgressPanel
                message={loadMessage || t.organize.preparing}
                percent={loadPercent}
                onCancel={() => abortRef.current?.abort()}
              />
            ) : (
              <>
                <div className="rounded-3xl border bg-white p-5 shadow-sm">
                  <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {pages.map((page, index) => {
                      const quarterTurn = page.rotation % 180 !== 0;
                      return (
                        <li
                          key={page.id}
                          draggable
                          onDragStart={() => setDraggedId(page.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => {
                            if (draggedId) {
                              movePage(
                                pages.findIndex((item) => item.id === draggedId),
                                index
                              );
                            }
                            setDraggedId(null);
                          }}
                          onDragEnd={() => setDraggedId(null)}
                          className="group rounded-2xl border bg-gray-50 p-3 transition-all hover:border-blue-200 hover:bg-blue-50"
                        >
                          <div className="mb-3 flex items-center justify-between">
                            <span className="text-xs font-semibold tabular-nums text-gray-500">
                              {t.organize.pageLabel(page.pageNumber)}
                            </span>
                            <GripVertical className="h-4 w-4 cursor-grab text-gray-300 group-hover:text-blue-400" />
                          </div>

                          <div className="mb-3 flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl border bg-white">
                            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, which next/image cannot optimise */}
                            <img
                              src={page.previewUrl}
                              alt={t.organize.pageLabel(page.pageNumber)}
                              className="max-h-full max-w-full object-contain transition-transform"
                              style={{
                                transform: `rotate(${page.rotation}deg)`,
                                // A quarter turn swaps width and height, so the
                                // preview has to shrink to stay inside its frame.
                                maxWidth: quarterTurn ? `${page.aspect * 100}%` : '100%',
                                maxHeight: quarterTurn ? `${(1 / page.aspect) * 100}%` : '100%',
                              }}
                            />
                          </div>

                          <div className="grid grid-cols-4 gap-1">
                            <button
                              type="button"
                              onClick={() => movePage(index, index - 1)}
                              disabled={index === 0}
                              aria-label={t.organize.moveEarlier(page.pageNumber)}
                              className="rounded-lg border bg-white p-2 text-gray-500 transition-colors hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ArrowLeft className="mx-auto h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => movePage(index, index + 1)}
                              disabled={index === pages.length - 1}
                              aria-label={t.organize.moveLater(page.pageNumber)}
                              className="rounded-lg border bg-white p-2 text-gray-500 transition-colors hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ArrowRight className="mx-auto h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setPages((previous) =>
                                  previous.map((item) =>
                                    item.id === page.id
                                      ? { ...item, rotation: (item.rotation + 90) % 360 }
                                      : item
                                  )
                                )
                              }
                              aria-label={t.organize.rotate(page.pageNumber)}
                              className="rounded-lg border bg-white p-2 text-gray-500 transition-colors hover:text-blue-600"
                            >
                              <RotateCw className="mx-auto h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setPages((previous) => {
                                  const target = previous.find((item) => item.id === page.id);
                                  if (target) URL.revokeObjectURL(target.previewUrl);
                                  return previous.filter((item) => item.id !== page.id);
                                })
                              }
                              disabled={pages.length === 1}
                              aria-label={t.organize.remove(page.pageNumber)}
                              className="rounded-lg border bg-white p-2 text-gray-500 transition-colors hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Trash2 className="mx-auto h-4 w-4" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
                  <p className="text-sm text-gray-500">
                    {t.organize.hint}
                  </p>
                  <button
                    type="button"
                    onClick={save}
                    disabled={pages.length === 0 || isProcessing}
                    className="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" /> {t.common.saving}
                      </>
                    ) : (
                      t.organize.action
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
