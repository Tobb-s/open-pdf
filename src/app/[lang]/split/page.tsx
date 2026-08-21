'use client';

import { useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { loadPdf, savePdf } from '@/lib/pdfio';
import JSZip from 'jszip';
import Navbar from '@/components/Navbar';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import ProgressPanel from '@/components/ProgressPanel';
import { Download, FileText, Layers, Loader2, Upload, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { describeError, KnownToolError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob } from '@/lib/files';
import { assertFileSize, throwIfCancelled, yieldToBrowser } from '@/lib/limits';
import { parsePageRange, summarizePages } from '@/lib/pageRange';

type Result =
  | { kind: 'single'; blob: Blob; pages: number }
  | { kind: 'zip'; blob: Blob; files: number };

export default function SplitPage() {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [range, setRange] = useState('');
  const [splitEachPage, setSplitEachPage] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<ToolError | null>(null);
  const bytesRef = useRef<Uint8Array | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Parsed as the reader types, so the selection can be echoed back before they commit.
  const parsed = useMemo(
    () => (pageCount > 0 ? parsePageRange(range, pageCount) : { pages: [], invalid: [] }),
    [range, pageCount]
  );

  const reset = () => {
    bytesRef.current = null;
    setFile(null);
    setPageCount(0);
    setRange('');
    setSplitEachPage(false);
    setResult(null);
    setError(null);
    setProgressPercent(0);
  };

  const selectFile = async (selected: File) => {
    reset();
    try {
      assertFileSize(selected, t);
      const bytes = new Uint8Array(await selected.arrayBuffer());
      const document_ = await loadPdf(bytes, { updateMetadata: false });
      bytesRef.current = bytes;
      setFile(selected);
      setPageCount(document_.getPageCount());
    } catch (caught) {
      setError(describeError(caught, t));
    }
  };

  const split = async () => {
    const bytes = bytesRef.current;
    if (!bytes || !file) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setIsProcessing(true);
    setError(null);

    try {
      const source = await loadPdf(bytes, { updateMetadata: false });

      if (splitEachPage) {
        const zip = new JSZip();
        const width = String(pageCount).length;

        for (let index = 0; index < pageCount; index += 1) {
          throwIfCancelled(controller.signal, t);
          setProgressPercent(((index + 1) / pageCount) * 92);
          setProgressMessage(t.split.extractingPage(index + 1, pageCount));

          const single = await PDFDocument.create();
          const [copied] = await single.copyPages(source, [index]);
          single.addPage(copied);
          const saved = (await savePdf(single)).slice();
          zip.file(`page-${String(index + 1).padStart(width, '0')}.pdf`, saved);
          // Let the progress bar paint and a Cancel click land between pages;
          // without pdf-lib's ticks nothing else in this loop yields.
          await yieldToBrowser();
        }

        setProgressMessage(t.split.packing);
        setProgressPercent(96);
        setResult({
          kind: 'zip',
          blob: await zip.generateAsync({ type: 'blob' }),
          files: pageCount,
        });
      } else {
        if (parsed.pages.length === 0) {
          throw new KnownToolError(
            'unknown',
            t.split.noneTitle,
            t.split.noneBody(pageCount)
          );
        }

        setProgressMessage(t.split.extracting);
        setProgressPercent(40);

        const output = await PDFDocument.create();
        const copied = await output.copyPages(
          source,
          parsed.pages.map((page) => page - 1)
        );
        for (const page of copied) output.addPage(page);

        const saved = (await savePdf(output)).slice();
        setResult({
          kind: 'single',
          blob: new Blob([saved], { type: 'application/pdf' }),
          pages: parsed.pages.length,
        });
      }

      setProgressPercent(100);
    } catch (caught) {
      const described = describeError(caught, t);
      if (described.kind !== 'cancelled') setError(described);
    } finally {
      abortRef.current = null;
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-12 text-center">
          <h1 className="mb-4 text-4xl font-bold text-gray-900">{t.split.heading}</h1>
          <p className="text-gray-600">{t.split.intro}</p>
        </div>

        {!result ? (
          <div className="space-y-8">
            {!file ? (
              <>
                <FileDropzone
                  inputId="split-file-input"
                  kind={PDF_FILES}
                  onFilesSelected={([selected]) => void selectFile(selected)}
                  className="cursor-pointer rounded-3xl border-2 border-dashed border-gray-300 bg-white p-12 text-center transition-all hover:border-blue-400"
                >
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                      <Upload className="h-8 w-8" />
                    </div>
                    <p className="text-lg font-semibold">{t.common.choosePdf}</p>
                    <p className="text-sm text-gray-500">{t.common.orDropIt}</p>
                  </div>
                </FileDropzone>
                <ErrorNotice error={error} onDismiss={() => setError(null)} />
              </>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center justify-between rounded-2xl border bg-white p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText className="h-6 w-6 shrink-0 text-blue-500" />
                    <span className="truncate font-medium">{file.name}</span>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">
                      {pageCount} {pageCount === 1 ? t.common.page : t.common.pages}
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

                <div className="space-y-4 rounded-3xl border bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label htmlFor="page-range" className="block text-sm font-medium text-gray-700">
                      {t.split.rangeLabel}
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={splitEachPage}
                          onChange={(event) => setSplitEachPage(event.target.checked)}
                          className="peer sr-only"
                        />
                        <div className="h-5 w-9 rounded-full bg-gray-200 transition-colors peer-checked:bg-blue-600" />
                        <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
                      </div>
                      <span className="flex items-center gap-1.5 text-sm text-gray-600">
                        <Layers className="h-4 w-4" />
                        {t.split.eachPage}
                      </span>
                    </label>
                  </div>

                  <div className="flex flex-col gap-4 sm:flex-row">
                    <input
                      id="page-range"
                      type="text"
                      value={range}
                      onChange={(event) => setRange(event.target.value)}
                      placeholder={t.split.placeholder}
                      disabled={splitEachPage}
                      className="flex-1 rounded-xl border px-4 py-3 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                    />
                    <button
                      type="button"
                      onClick={split}
                      disabled={
                        isProcessing || (!splitEachPage && parsed.pages.length === 0)
                      }
                      className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-bold text-white transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" /> {t.split.working}
                        </>
                      ) : (
                        t.split.action
                      )}
                    </button>
                  </div>

                  {splitEachPage ? (
                    <p className="text-xs text-blue-600">
                      {t.split.eachPageNote(pageCount)}
                    </p>
                  ) : (
                    <div className="space-y-1 text-xs">
                      <p className="text-gray-500">{t.split.syntaxNote}</p>
                      {parsed.pages.length > 0 && (
                        <p className="text-emerald-700">
                          {t.split.selected(parsed.pages.length, summarizePages(parsed.pages))}
                        </p>
                      )}
                      {parsed.invalid.length > 0 && (
                        <p className="text-amber-700">
                          {t.split.invalid(
                            parsed.invalid
                              .map((token) => `\u201c${token}\u201d`)
                              .join(', '),
                            pageCount
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <ErrorNotice error={error} onDismiss={() => setError(null)} />

                {isProcessing && splitEachPage && (
                  <ProgressPanel
                    message={progressMessage}
                    percent={progressPercent}
                    onCancel={() => abortRef.current?.abort()}
                  />
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-3xl border bg-white p-12 text-center shadow-sm">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-600">
              {result.kind === 'zip' ? (
                <Layers className="h-10 w-10" />
              ) : (
                <FileText className="h-10 w-10" />
              )}
            </div>
            <h2 className="mb-2 text-2xl font-bold">
              {result.kind === 'zip'
                ? t.split.doneZip(result.files)
                : t.split.doneSingle(result.pages)}
            </h2>
            <p className="mb-8 text-gray-600">{t.split.doneBody}</p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <button
                type="button"
                onClick={() =>
                  file &&
                  downloadBlob(
                    result.blob,
                    derivedFileName(file.name, result.kind === 'zip' ? '_pages.zip' : '_extract.pdf')
                  )
                }
                className="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-blue-200 hover:bg-blue-700"
              >
                <Download className="h-5 w-5" />
                {result.kind === 'zip' ? t.split.downloadZip : t.split.downloadPdf}
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-full bg-gray-100 px-8 py-4 text-lg font-bold text-gray-700 hover:bg-gray-200"
              >
                {t.split.another}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
