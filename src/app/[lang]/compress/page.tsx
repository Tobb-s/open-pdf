'use client';

import { useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import Navbar from '@/components/Navbar';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import ProgressPanel from '@/components/ProgressPanel';
import {
  CheckCircle2,
  Download,
  FileText,
  Info,
  Minimize2,
  SlidersHorizontal,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { describeError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob, formatBytes } from '@/lib/files';
import {
  assertFileSize,
  assertPageCount,
  MAX_RENDERED_PAGES,
  throwIfCancelled,
} from '@/lib/limits';
import { openPdf, renderPageToJpeg } from '@/lib/pdfjs';

type CompressionLevel = 'extreme' | 'recommended' | 'low';

interface CompressionPreset {
  id: CompressionLevel;
  recommended?: boolean;
  scale: number;
  quality: number;
  color: string;
  border: string;
}

const PRESETS: CompressionPreset[] = [
  {
    id: 'extreme',
    scale: 0.8,
    quality: 0.4,
    color: 'text-amber-600',
    border: 'border-amber-300 ring-2 ring-amber-500/20',
  },
  {
    id: 'recommended',
    recommended: true,
    scale: 1.1,
    quality: 0.65,
    color: 'text-blue-600',
    border: 'border-blue-300 ring-2 ring-blue-500/20',
  },
  {
    id: 'low',
    scale: 1.5,
    quality: 0.85,
    color: 'text-emerald-600',
    border: 'border-emerald-300 ring-2 ring-emerald-500/20',
  },
];

/** Pages sampled to guess whether the document is mostly real text. */
const TEXT_SAMPLE_PAGES = 3;

interface CompressionResult {
  blob: Blob;
  size: number;
  pages: number;
  /** True when the rasterised copy came out no smaller than the original. */
  grew: boolean;
}

export default function CompressPage() {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [level, setLevel] = useState<CompressionLevel>('recommended');
  const [hasRealText, setHasRealText] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [result, setResult] = useState<CompressionResult | null>(null);
  const [error, setError] = useState<ToolError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setHasRealText(false);
    setProgressPercent(0);
  };

  const selectFile = async (selected: File) => {
    setFile(selected);
    setResult(null);
    setError(null);
    setHasRealText(false);

    // Sample a few pages for a text layer. Rasterising a text document destroys
    // that layer and often makes the file bigger, so the reader deserves to know
    // before they start rather than after.
    let source: Awaited<ReturnType<typeof openPdf>> | null = null;
    try {
      assertFileSize(selected, t);
      source = await openPdf(await selected.arrayBuffer());
      const sampled = Math.min(TEXT_SAMPLE_PAGES, source.document.numPages);
      let characters = 0;

      for (let pageNumber = 1; pageNumber <= sampled; pageNumber += 1) {
        const page = await source.document.getPage(pageNumber);
        const content = await page.getTextContent();
        characters += content.items.reduce(
          (total, item) => total + ('str' in item ? item.str.trim().length : 0),
          0
        );
        page.cleanup();
      }

      setHasRealText(characters > 200 * sampled);
    } catch (caught) {
      setError(describeError(caught, t));
      setFile(null);
    } finally {
      await source?.destroy().catch(() => {});
    }
  };

  const compress = async () => {
    if (!file) return;

    const controller = new AbortController();
    abortRef.current = controller;
    const preset = PRESETS.find((candidate) => candidate.id === level) ?? PRESETS[1];

    setIsProcessing(true);
    setError(null);
    setProgressPercent(4);
    setProgressMessage(t.compress.reading);

    let source: Awaited<ReturnType<typeof openPdf>> | null = null;

    try {
      source = await openPdf(await file.arrayBuffer());
      const pageCount = source.document.numPages;
      assertPageCount(pageCount, MAX_RENDERED_PAGES, 'compression', t);

      const output = await PDFDocument.create();

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        throwIfCancelled(controller.signal, t);
        setProgressPercent(4 + (pageNumber / pageCount) * 88);
        setProgressMessage(t.compress.compressingPage(pageNumber, pageCount));

        const page = await source.document.getPage(pageNumber);
        const { width: pointWidth, height: pointHeight } = page.getViewport({ scale: 1 });
        const { blob } = await renderPageToJpeg(page, preset.scale, preset.quality);
        page.cleanup();

        const image = await output.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const newPage = output.addPage([pointWidth, pointHeight]);
        newPage.drawImage(image, { x: 0, y: 0, width: pointWidth, height: pointHeight });
      }

      setProgressMessage(t.compress.saving);
      setProgressPercent(96);

      const bytes = (await output.save()).slice();
      setResult({
        blob: new Blob([bytes], { type: 'application/pdf' }),
        size: bytes.length,
        pages: pageCount,
        grew: bytes.length >= file.size,
      });
      setProgressPercent(100);
    } catch (caught) {
      const described = describeError(caught, t);
      if (described.kind !== 'cancelled') setError(described);
    } finally {
      abortRef.current = null;
      await source?.destroy().catch(() => {});
      setIsProcessing(false);
    }
  };

  const savedPercent =
    file && result && !result.grew ? Math.round(((file.size - result.size) / file.size) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50/50">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-10 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-blue-100/70 px-3 py-1 text-xs font-semibold text-blue-700">
            <Zap className="h-3.5 w-3.5 fill-blue-600 text-blue-600" />
            {t.compress.badge}
          </div>
          <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
            {t.compress.heading}
          </h1>
          <p className="mx-auto max-w-xl text-lg text-gray-600">
            {t.compress.intro}
          </p>
        </div>

        {!result ? (
          <div className="space-y-8">
            {!file ? (
              <>
                <FileDropzone
                  inputId="compress-file-input"
                  kind={PDF_FILES}
                  onFilesSelected={([selected]) => void selectFile(selected)}
                  className="group cursor-pointer rounded-3xl border-2 border-dashed border-gray-300 bg-white p-12 text-center transition-all hover:border-blue-500 hover:shadow-xl"
                >
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-50 text-blue-600 transition-transform group-hover:scale-110">
                      <Minimize2 className="h-10 w-10" />
                    </div>
                    <div>
                      <p className="mb-1 text-xl font-bold text-gray-900">{t.common.choosePdf}</p>
                      <p className="text-sm text-gray-500">{t.common.orDropIt}</p>
                    </div>
                  </div>
                </FileDropzone>
                <ErrorNotice error={error} onDismiss={() => setError(null)} />
              </>
            ) : (
              <div className="space-y-8">
                <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-gray-900">{file.name}</p>
                      <p className="text-xs text-gray-500">{formatBytes(file.size)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={reset}
                    aria-label={t.common.removeFile}
                    className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-500"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {hasRealText && (
                  <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <Info
                      className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
                      aria-hidden="true"
                    />
                    <div className="text-sm text-amber-900">
                      <p className="font-semibold">{t.compress.textWarningTitle}</p>
                      <p className="mt-1 leading-relaxed">{t.compress.textWarningBody}</p>
                    </div>
                  </div>
                )}

                <div>
                  <div className="mb-4 flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4 text-blue-600" />
                    <h2 className="text-lg font-bold text-gray-900">{t.compress.chooseLevel}</h2>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setLevel(preset.id)}
                        aria-pressed={level === preset.id}
                        className={cn(
                          'relative flex flex-col justify-between rounded-2xl border bg-white p-5 text-left transition-all',
                          level === preset.id
                            ? `${preset.border} shadow-md`
                            : 'border-gray-200 opacity-80 hover:border-gray-300 hover:opacity-100'
                        )}
                      >
                        {preset.recommended && (
                          <span className="absolute -top-3 right-4 rounded-full bg-blue-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
                            {t.compress.recommendedBadge}
                          </span>
                        )}
                        <span className={cn('mb-2 block text-base font-bold', preset.color)}>
                          {t.compress.presets[preset.id].title}
                        </span>
                        <span className="text-xs leading-relaxed text-gray-500">
                          {t.compress.presets[preset.id].description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <ErrorNotice error={error} onDismiss={() => setError(null)} />

                {isProcessing && (
                  <ProgressPanel
                    message={progressMessage}
                    percent={progressPercent}
                    onCancel={() => abortRef.current?.abort()}
                  />
                )}

                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={compress}
                    disabled={isProcessing}
                    className="flex items-center gap-3 rounded-full bg-blue-600 px-10 py-4 text-lg font-bold text-white shadow-xl shadow-blue-200 transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    <Sparkles className="h-5 w-5" />
                    {isProcessing ? t.compress.working : t.compress.action}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-sm sm:p-12">
            <div
              className={cn(
                'mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full',
                result.grew ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'
              )}
            >
              {result.grew ? <Info className="h-10 w-10" /> : <CheckCircle2 className="h-10 w-10" />}
            </div>

            <h2 className="mb-2 text-3xl font-extrabold text-gray-900">
              {result.grew ? t.compress.grewTitle : t.compress.doneTitle}
            </h2>
            <p className="mx-auto mb-8 max-w-lg text-gray-500">
              {result.grew ? t.compress.grewBody : t.compress.doneBody(result.pages)}
            </p>

            <div className="mx-auto mb-10 grid max-w-xl grid-cols-1 gap-4 rounded-2xl border border-gray-100 bg-slate-50 p-6 sm:grid-cols-3">
              <div className="flex flex-col">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {t.compress.original}
                </span>
                <span className="text-lg font-bold tabular-nums text-gray-700">
                  {formatBytes(file?.size ?? 0)}
                </span>
              </div>
              <div className="flex flex-col border-y border-gray-200 py-3 sm:border-x sm:border-y-0 sm:py-0">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {t.compress.compressed}
                </span>
                <span className="text-lg font-bold tabular-nums text-blue-600">
                  {formatBytes(result.size)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {t.compress.saved}
                </span>
                <span
                  className={cn(
                    'text-lg font-extrabold tabular-nums',
                    result.grew ? 'text-amber-600' : 'text-emerald-600'
                  )}
                >
                  {result.grew ? t.compress.savedNothing : `${savedPercent}%`}
                </span>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              {!result.grew && (
                <button
                  type="button"
                  onClick={() =>
                    file && downloadBlob(result.blob, derivedFileName(file.name, '_compressed.pdf'))
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-blue-600 px-9 py-4 text-lg font-bold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 sm:w-auto"
                >
                  <Download className="h-5 w-5" />
                  {t.common.download}
                </button>
              )}
              {result.grew && (
                <button
                  type="button"
                  onClick={() =>
                    file && downloadBlob(result.blob, derivedFileName(file.name, '_compressed.pdf'))
                  }
                  className="w-full rounded-full bg-gray-100 px-8 py-4 text-base font-semibold text-gray-700 transition-all hover:bg-gray-200 sm:w-auto"
                >
                  {t.compress.downloadAnyway}
                </button>
              )}
              <button
                type="button"
                onClick={reset}
                className="w-full rounded-full bg-gray-100 px-8 py-4 text-lg font-bold text-gray-700 transition-all hover:bg-gray-200 sm:w-auto"
              >
                {t.compress.another}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
