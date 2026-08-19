'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { PDFDocument } from 'pdf-lib';
import Navbar from '@/components/Navbar';
import FileDropzone, { OFFICE_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import {
  CheckCircle2,
  Download,
  FileText,
  Info,
  Loader2,
  Presentation,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { describeError, KnownToolError, type ToolError } from '@/lib/errors';
import { downloadBlob, formatBytes } from '@/lib/files';
import { assertFileSize } from '@/lib/limits';
import {
  ConversionAbandoned,
  ENGINE_DOWNLOAD_BYTES,
  engineSupported,
  formatForFile,
  getOfficeEngine,
  OFFICE_EXTENSIONS,
  pdfNameFor,
  type OfficeFormat,
} from '@/lib/office';

type Stage = 'idle' | 'downloading' | 'starting' | 'converting' | 'opening' | 'exporting';

interface Result {
  blob: Blob;
  pages: number;
  name: string;
}

export default function OfficeToPdfPage() {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<OfficeFormat | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [percent, setPercent] = useState(0);
  // The engine is kept alive between conversions. It does slow down as it is
  // reused — the same deck took 17 s first and 38 s second — but starting a
  // second one is worse: the first is never truly torn down, so the new boot
  // competes with it for memory and took over a minute and a half. Reuse is the
  // fast path; the timeout below is what stops a degraded engine hanging.
  const [engineCached, setEngineCached] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<ToolError | null>(null);
  // `crossOriginIsolated` does not exist while rendering on the server, so the
  // server assumes support and the client corrects it. Assuming the opposite
  // would flash an error at everyone on first paint.
  const supported = useSyncExternalStore(
    () => () => {},
    engineSupported,
    () => true
  );

  const busy = stage !== 'idle';
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    setFile(null);
    setFormat(null);
    setResult(null);
    setError(null);
    setPercent(0);
  };

  const selectFile = (selected: File) => {
    setResult(null);
    setError(null);

    const matched = formatForFile(selected.name);
    if (!matched) {
      setFile(null);
      setFormat(null);
      setError({
        kind: 'invalid',
        title: t.officeToPdf.unsupportedTitle(selected.name),
        detail: t.officeToPdf.unsupportedBody(OFFICE_EXTENSIONS.join(', ')),
      });
      return;
    }

    setFile(selected);
    setFormat(matched);
  };

  const convert = async () => {
    if (!file || !format) return;

    setError(null);
    setStage(engineCached ? 'converting' : 'downloading');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      assertFileSize(file, t);

      const engine = await getOfficeEngine((progress) => {
        if (progress.phase === 'downloading' && progress.fraction !== null) {
          setStage('downloading');
          setPercent(Math.round(progress.fraction * 100));
        } else {
          setStage('starting');
        }
      });
      setEngineCached(true);

      setStage('converting');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await engine.convert(file, bytes, format, controller.signal, (phase) =>
        setStage(phase)
      );

      // Reading the page count back is a cheap sanity check: an engine that
      // returns bytes which are not a PDF should not reach the success screen.
      let pages: number;
      try {
        pages = (await PDFDocument.load(pdf)).getPageCount();
      } catch {
        throw new KnownToolError(
          'unknown',
          t.errors.officeFailedTitle,
          t.errors.officeFailedBody('the output was not a readable PDF')
        );
      }

      setResult({
        blob: new Blob([pdf as unknown as BlobPart], { type: 'application/pdf' }),
        pages,
        name: pdfNameFor(file.name),
      });
    } catch (caught) {
      // A document that wedged the engine, or one the reader gave up on, is not
      // a generic failure and should not read like one.
      if (caught instanceof ConversionAbandoned) {
        setError(
          caught.timedOut
            ? {
                kind: 'unknown',
                title: t.officeToPdf.abandonedTitle,
                detail: caught.phase
                  ? `${t.officeToPdf.abandonedWhile(t.officeToPdf.phases[caught.phase])} ${t.officeToPdf.abandonedBody}`
                  : t.officeToPdf.abandonedBody,
              }
            : {
                kind: 'cancelled',
                title: t.officeToPdf.cancelledTitle,
                detail: t.officeToPdf.cancelledBody,
              }
        );
        return;
      }

      const described = describeError(caught, t);
      setError(
        described.kind === 'unknown'
          ? {
              kind: 'unknown',
              title: t.errors.officeFailedTitle,
              detail: t.errors.officeFailedBody(described.detail),
            }
          : described
      );
    } finally {
      abortRef.current = null;
      setStage('idle');
      setPercent(0);
    }
  };

  const name = file?.name ?? '';
  const stageMessage =
    stage === 'downloading'
      ? t.officeToPdf.downloading
      : stage === 'starting'
        ? t.officeToPdf.starting
        : stage === 'opening'
          ? t.officeToPdf.opening(name)
          : stage === 'exporting'
            ? t.officeToPdf.exporting(name)
            : t.officeToPdf.converting(name);

  return (
    <div className="min-h-screen bg-slate-50/50">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 text-sky-600 shadow-sm">
            <Presentation className="h-8 w-8" />
          </div>
          <h1 className="mb-3 text-4xl font-semibold tracking-tight text-gray-900">
            {t.officeToPdf.heading}
          </h1>
          <p className="mx-auto max-w-xl text-gray-600">{t.officeToPdf.intro}</p>
        </div>

        <div className="rounded-3xl border border-gray-100 bg-white p-8 shadow-sm sm:p-10">
          {!supported ? (
            <ErrorNotice
              error={{
                kind: 'assets',
                title: t.officeToPdf.unsupportedBrowserTitle,
                detail: t.officeToPdf.unsupportedBrowserBody,
              }}
            />
          ) : result ? (
            <div className="text-center">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-10 w-10" />
              </div>
              <h2 className="mb-2 text-2xl font-bold text-gray-900">{t.officeToPdf.doneTitle}</h2>
              <p className="mb-8 text-gray-500">
                {t.officeToPdf.doneBody(result.pages, formatBytes(result.blob.size))}
              </p>
              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <button
                  type="button"
                  onClick={() => downloadBlob(result.blob, result.name)}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-sky-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-sky-200 transition-all hover:bg-sky-700 sm:w-auto"
                >
                  <Download className="h-5 w-5" />
                  {t.common.download}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="w-full rounded-full bg-gray-100 px-8 py-4 text-lg font-bold text-gray-700 transition-all hover:bg-gray-200 sm:w-auto"
                >
                  {t.officeToPdf.another}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {!file ? (
                <FileDropzone
                  inputId="office-file-input"
                  kind={OFFICE_FILES}
                  disabled={busy}
                  onFilesSelected={([selected]) => selectFile(selected)}
                  className="cursor-pointer rounded-3xl border-2 border-dashed border-gray-300 bg-gray-50 p-12 text-center transition-all hover:border-sky-400 hover:bg-gray-100"
                >
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                      <Upload className="h-8 w-8" />
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{t.officeToPdf.choose}</p>
                      <p className="mt-1 text-sm text-gray-500">{t.officeToPdf.accepts}</p>
                    </div>
                  </div>
                </FileDropzone>
              ) : (
                <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-gray-900">{file.name}</p>
                      <p className="text-xs text-gray-500">
                        {format && t.officeToPdf.families[format.family]} ·{' '}
                        {formatBytes(file.size)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={reset}
                    disabled={busy}
                    aria-label={t.common.removeFile}
                    className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-500 disabled:opacity-40"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              )}

              {format?.legacy && (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                  <p className="text-sm text-amber-900">
                    {t.officeToPdf.legacyNote(format.extension)}
                  </p>
                </div>
              )}

              <ErrorNotice error={error} onDismiss={() => setError(null)} />

              {file && !engineCached && (
                <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-5">
                  <h2 className="mb-2 font-semibold text-sky-950">
                    {t.officeToPdf.engineTitle}
                  </h2>
                  <p className="text-sm leading-relaxed text-sky-900">
                    {t.officeToPdf.engineBody(formatBytes(ENGINE_DOWNLOAD_BYTES))}
                  </p>
                  <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-sky-800">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {t.officeToPdf.enginePrivacy}
                  </p>
                </div>
              )}

              {busy && (
                <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-6">
                  <div className="flex items-center justify-between gap-4 text-sm font-semibold text-gray-700">
                    <span className="flex min-w-0 items-center gap-2">
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-600" />
                      <span className="truncate">{stageMessage}</span>
                    </span>
                    {stage === 'downloading' && (
                      <span className="shrink-0 tabular-nums text-sky-600">{percent}%</span>
                    )}
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={cn(
                        'h-2.5 rounded-full bg-sky-600 transition-all duration-300',
                        stage !== 'downloading' && 'animate-pulse'
                      )}
                      style={{ width: stage === 'downloading' ? `${percent}%` : '100%' }}
                    />
                  </div>
                  {stage !== 'downloading' && stage !== 'starting' && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => abortRef.current?.abort()}
                        className="rounded-full px-4 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                      >
                        {t.common.cancel}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {file && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={convert}
                    disabled={busy}
                    className="flex items-center gap-2 rounded-full bg-sky-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-sky-200 transition-all hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {engineCached ? t.officeToPdf.action : t.officeToPdf.engineAction}
                  </button>
                </div>
              )}

              {file && engineCached && !busy && (
                <p className="text-center text-xs leading-relaxed text-gray-500">
                  {t.officeToPdf.reuseNote}
                </p>
              )}

              <p className="border-t border-gray-100 pt-5 text-sm leading-relaxed text-gray-500">
                {t.officeToPdf.slidesTip}
              </p>
            </div>
          )}
        </div>
      </main>

      {/* LibreOffice is built on Qt, which insists on a canvas even when it draws
          nothing. Parked off-screen rather than hidden: a display:none canvas has
          no dimensions and Qt trips over that. */}
      <canvas
        id="qtcanvas"
        width={16}
        height={16}
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: 'absolute', left: -9999, top: 0, width: 16, height: 16 }}
      />
    </div>
  );
}
