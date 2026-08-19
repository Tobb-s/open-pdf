'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import Navbar from '@/components/Navbar';
import FileDropzone, { OFFICE_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
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
import { combinePdfs } from '@/lib/combine';
import {
  clearIsolationRetry,
  ConversionAbandoned,
  ENGINE_DOWNLOAD_BYTES,
  formatForFile,
  getOfficeEngine,
  isolationStatus,
  OFFICE_EXTENSIONS,
  pdfNameFor,
  reloadForIsolation,
  uniqueNames,
  type OfficeFormat,
} from '@/lib/office';

type OutputMode = 'separate' | 'combined';
type Stage =
  | 'idle'
  | 'downloading'
  | 'starting'
  | 'converting'
  | 'opening'
  | 'exporting'
  | 'combining'
  | 'zipping';
type ItemStatus = 'pending' | 'working' | 'done' | 'failed';

interface QueueItem {
  id: number;
  file: File;
  format: OfficeFormat;
  status: ItemStatus;
  pages?: number;
}

interface BatchResult {
  blob: Blob;
  converted: number;
  total: number;
  /** Pages in the resulting PDF; absent for a zip of several files. */
  pages?: number;
  /** Documents that never produced a PDF. */
  failed: string[];
  /** Documents that converted but could not be appended to the combined PDF. */
  skipped: string[];
  downloadName: string;
}

export default function OfficeToPdfPage() {
  const { t } = useI18n();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [mode, setMode] = useState<OutputMode>('separate');
  const [stage, setStage] = useState<Stage>('idle');
  const [percent, setPercent] = useState(0);
  const [current, setCurrent] = useState<{ index: number; name: string; total?: number } | null>(
    null
  );
  const [engineCached, setEngineCached] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<ToolError | null>(null);

  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);

  // `crossOriginIsolated` does not exist while rendering on the server, so the
  // server assumes support and the client corrects it. Assuming the opposite
  // would flash an error at everyone on first paint.
  const isolation = useSyncExternalStore(() => () => {}, isolationStatus, () => 'ready' as const);

  // Arriving here through a client-side navigation means the document was never
  // fetched, so the route's isolation headers never applied. One reload picks
  // them up; the helper refuses to loop if that does not work.
  useEffect(() => {
    if (isolation === 'retrying') reloadForIsolation();
    else if (isolation === 'ready') clearIsolationRetry();
  }, [isolation]);

  // Walking away from a running batch should stop it, not leave it grinding
  // through documents nobody is waiting for.
  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = stage !== 'idle';

  const reset = () => {
    setQueue([]);
    setResult(null);
    setError(null);
    setPercent(0);
    setCurrent(null);
  };

  const addFiles = (files: File[]) => {
    setResult(null);
    setError(null);

    const rejected: string[] = [];
    const accepted: QueueItem[] = [];

    for (const file of files) {
      const format = formatForFile(file.name);
      if (!format) {
        rejected.push(file.name);
        continue;
      }
      accepted.push({ id: nextId.current++, file, format, status: 'pending' });
    }

    if (rejected.length > 0) {
      setError({
        kind: 'invalid',
        title: t.officeToPdf.unsupportedTitle(rejected.join(', ')),
        detail: t.officeToPdf.unsupportedBody(OFFICE_EXTENSIONS.join(', ')),
      });
    }
    if (accepted.length > 0) {
      setQueue((previous) => [...previous, ...accepted]);
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    setQueue((previous) => {
      const target = index + direction;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const markItem = (id: number, patch: Partial<QueueItem>) => {
    setQueue((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const convert = async () => {
    if (queue.length === 0) return;

    // Timing a document out retires the engine, so the loop has to ask for one
    // before every document rather than holding a reference that may be dead.
    const acquireEngine = () =>
      getOfficeEngine((progress) => {
        if (progress.phase === 'downloading' && progress.fraction !== null) {
          setStage('downloading');
          setPercent(Math.round(progress.fraction * 100));
        } else {
          setStage('starting');
        }
      });

    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setResult(null);
    setStage(engineCached ? 'converting' : 'downloading');
    setQueue((previous) =>
      previous.map((item) => ({ ...item, status: 'pending' as const, pages: undefined }))
    );

    // The order is fixed when the run starts. Reordering halfway through would
    // make the numbering lie, and the controls are disabled while it works.
    const items = [...queue];
    const converted: { item: QueueItem; pdf: Uint8Array; pages: number }[] = [];
    const failed: string[] = [];

    try {
      await acquireEngine();
      setEngineCached(true);

      for (const [index, item] of items.entries()) {
        if (controller.signal.aborted) break;

        setCurrent({ index: index + 1, name: item.file.name });
        setStage('converting');
        markItem(item.id, { status: 'working' });

        try {
          assertFileSize(item.file, t);
          // Re-acquired each time: cheap when the engine is alive, and the only
          // way to recover after a timeout retired the previous one.
          const engine = await acquireEngine();
          setStage('converting');

          const bytes = new Uint8Array(await item.file.arrayBuffer());
          const pdf = await engine.convert(
            item.file,
            bytes,
            item.format,
            controller.signal,
            (phase) => setStage(phase)
          );

          // A document that came back as something other than a PDF must not be
          // counted among the converted.
          const pages = (await PDFDocument.load(pdf)).getPageCount();

          converted.push({ item, pdf, pages });
          markItem(item.id, { status: 'done', pages });
        } catch (caught) {
          // Cancelling stops the batch; one document wedging the engine does not.
          if (caught instanceof ConversionAbandoned && !caught.timedOut) throw caught;

          const timedOut = caught instanceof ConversionAbandoned;
          failed.push(
            timedOut ? `${item.file.name} (${t.officeToPdf.timedOutItem})` : item.file.name
          );
          markItem(item.id, { status: 'failed' });
        }
      }

      if (controller.signal.aborted) {
        setError({
          kind: 'cancelled',
          title: t.officeToPdf.cancelledTitle,
          detail: t.officeToPdf.cancelledPartial(converted.length),
        });
        setQueue((previous) =>
          previous.map((entry) =>
            entry.status === 'working' ? { ...entry, status: 'pending' as const } : entry
          )
        );
        return;
      }

      if (converted.length === 0) {
        throw new KnownToolError(
          'unknown',
          t.officeToPdf.batchNoneTitle,
          t.officeToPdf.batchNoneBody
        );
      }

      if (mode === 'combined') {
        setStage('combining');
        const combined = await combinePdfs(
          converted.map(({ item, pdf }) => ({ bytes: pdf, label: item.file.name })),
          {
            signal: controller.signal,
            onProgress: (index, total, label) => setCurrent({ index, name: label, total }),
          }
        );
        if (controller.signal.aborted) {
          setError({
            kind: 'cancelled',
            title: t.officeToPdf.cancelledTitle,
            detail: t.officeToPdf.cancelledPartial(converted.length),
          });
          return;
        }

        setResult({
          blob: new Blob([combined.bytes as unknown as BlobPart], { type: 'application/pdf' }),
          // Documents actually inside the PDF being downloaded — a part that
          // could not be appended is not "converted" from the reader's side.
          converted: converted.length - combined.skipped.length,
          total: items.length,
          pages: combined.pages,
          failed,
          skipped: combined.skipped,
          downloadName:
            converted.length === 1
              ? pdfNameFor(converted[0].item.file.name)
              : t.officeToPdf.combinedName,
        });
        return;
      }

      // One document does not need a zip wrapped around it.
      if (converted.length === 1) {
        const only = converted[0];
        setResult({
          blob: new Blob([only.pdf as unknown as BlobPart], { type: 'application/pdf' }),
          converted: 1,
          total: items.length,
          pages: only.pages,
          failed,
          skipped: [],
          downloadName: pdfNameFor(only.item.file.name),
        });
        return;
      }

      setStage('zipping');
      setCurrent(null);
      const names = uniqueNames(converted.map(({ item }) => item.file.name));
      const zip = new JSZip();
      converted.forEach(({ pdf }, index) => zip.file(names[index], pdf));

      const archive = await zip.generateAsync({ type: 'blob' });
      if (controller.signal.aborted) {
        setError({
          kind: 'cancelled',
          title: t.officeToPdf.cancelledTitle,
          detail: t.officeToPdf.cancelledPartial(converted.length),
        });
        return;
      }

      setResult({
        blob: archive,
        converted: converted.length,
        total: items.length,
        failed,
        skipped: [],
        downloadName: t.officeToPdf.zipName,
      });
    } catch (caught) {
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
        described.kind === 'unknown' && !(caught instanceof KnownToolError)
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
      setCurrent(null);
    }
  };

  const stageMessage =
    stage === 'downloading'
      ? t.officeToPdf.downloading
      : stage === 'starting'
        ? t.officeToPdf.starting
        : stage === 'zipping'
          ? t.officeToPdf.zipping
          : stage === 'combining'
            ? current
              ? t.officeToPdf.combiningItem(
                  current.index,
                  current.total ?? queue.length,
                  current.name
                )
              : t.officeToPdf.combining
            : current
              ? t.officeToPdf.convertingItem(current.index, queue.length, current.name)
              : t.officeToPdf.starting;

  const legacyExtensions = [
    ...new Set(queue.filter((item) => item.format.legacy).map((item) => item.format.extension)),
  ];

  const outputModes: { id: OutputMode; title: string; body: string }[] = [
    { id: 'separate', title: t.officeToPdf.separateTitle, body: t.officeToPdf.separateBody },
    { id: 'combined', title: t.officeToPdf.combinedTitle, body: t.officeToPdf.combinedBody },
  ];

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
          {isolation === 'retrying' ? (
            <div className="flex items-center justify-center gap-3 py-10 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
              <span>{t.officeToPdf.preparing}</span>
            </div>
          ) : isolation === 'unsupported' ? (
            <ErrorNotice
              error={{
                kind: 'assets',
                title: t.officeToPdf.unsupportedBrowserTitle,
                detail: t.officeToPdf.unsupportedBrowserBody,
              }}
            />
          ) : result ? (
            <div className="text-center">
              <div
                className={cn(
                  'mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full',
                  result.failed.length > 0
                    ? 'bg-amber-100 text-amber-600'
                    : 'bg-emerald-100 text-emerald-600'
                )}
              >
                {result.failed.length > 0 ? (
                  <AlertTriangle className="h-10 w-10" />
                ) : (
                  <CheckCircle2 className="h-10 w-10" />
                )}
              </div>

              <h2 className="mb-2 text-2xl font-bold text-gray-900">
                {result.total === 1
                  ? t.officeToPdf.doneTitle
                  : t.officeToPdf.batchDoneTitle(result.converted, result.total)}
              </h2>
              <p className="mb-6 text-gray-500">
                {result.pages !== undefined
                  ? t.officeToPdf.batchDoneCombined(result.pages, formatBytes(result.blob.size))
                  : t.officeToPdf.batchDoneZip(result.converted, formatBytes(result.blob.size))}
              </p>

              {(result.failed.length > 0 || result.skipped.length > 0) && (
                <div className="mx-auto mb-8 max-w-lg space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">
                  {result.failed.length > 0 && (
                    <p>{t.officeToPdf.batchFailures(result.failed.join(', '))}</p>
                  )}
                  {result.skipped.length > 0 && (
                    <p>{t.officeToPdf.combineSkipped(result.skipped.join(', '))}</p>
                  )}
                </div>
              )}

              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <button
                  type="button"
                  onClick={() => downloadBlob(result.blob, result.downloadName)}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-sky-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-sky-200 transition-all hover:bg-sky-700 sm:w-auto"
                >
                  <Download className="h-5 w-5" />
                  {result.downloadName.endsWith('.zip')
                    ? t.officeToPdf.downloadZip
                    : t.common.download}
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
              {queue.length === 0 ? (
                <FileDropzone
                  inputId="office-file-input"
                  kind={OFFICE_FILES}
                  multiple
                  disabled={busy}
                  onFilesSelected={addFiles}
                  className="cursor-pointer rounded-3xl border-2 border-dashed border-gray-300 bg-gray-50 p-12 text-center transition-all hover:border-sky-400 hover:bg-gray-100"
                >
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                      <Upload className="h-8 w-8" />
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{t.officeToPdf.chooseMany}</p>
                      <p className="mt-1 text-sm text-gray-500">{t.officeToPdf.accepts}</p>
                    </div>
                  </div>
                </FileDropzone>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-medium text-gray-700">
                      {t.officeToPdf.queueHeading(queue.length)}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setQueue([])}
                      disabled={busy}
                      className="text-sm text-sky-600 hover:underline disabled:opacity-40"
                    >
                      {t.officeToPdf.removeAll}
                    </button>
                  </div>

                  <ol className="space-y-2">
                    {queue.map((item, index) => (
                      <li
                        key={item.id}
                        className={cn(
                          'flex items-center gap-3 rounded-xl border bg-white p-3',
                          item.status === 'working' && 'border-sky-300 bg-sky-50/50',
                          item.status === 'failed' && 'border-amber-200 bg-amber-50/50'
                        )}
                      >
                        <span className="w-5 shrink-0 text-center text-sm tabular-nums text-gray-400">
                          {index + 1}
                        </span>

                        {item.status === 'working' ? (
                          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-sky-600" />
                        ) : item.status === 'done' ? (
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                        ) : item.status === 'failed' ? (
                          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                        ) : (
                          <FileText className="h-5 w-5 shrink-0 text-gray-400" />
                        )}

                        <span className="min-w-0 flex-1 truncate text-sm">{item.file.name}</span>

                        <span className="hidden shrink-0 text-xs tabular-nums text-gray-400 sm:inline">
                          {item.status === 'done' && item.pages !== undefined
                            ? t.officeToPdf.statusDone(item.pages)
                            : item.status === 'failed'
                              ? t.officeToPdf.statusFailed
                              : formatBytes(item.file.size)}
                        </span>

                        <div className="flex shrink-0 items-center">
                          <button
                            type="button"
                            onClick={() => move(index, -1)}
                            disabled={busy || index === 0}
                            aria-label={t.officeToPdf.moveEarlier(item.file.name)}
                            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-sky-600 disabled:opacity-30"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => move(index, 1)}
                            disabled={busy || index === queue.length - 1}
                            aria-label={t.officeToPdf.moveLater(item.file.name)}
                            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-sky-600 disabled:opacity-30"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setQueue((previous) =>
                                previous.filter((candidate) => candidate.id !== item.id)
                              )
                            }
                            disabled={busy}
                            aria-label={t.officeToPdf.remove(item.file.name)}
                            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-500 disabled:opacity-30"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>

                  <FileDropzone
                    inputId="office-file-add"
                    kind={OFFICE_FILES}
                    multiple
                    disabled={busy}
                    onFilesSelected={addFiles}
                    className="cursor-pointer rounded-xl border-2 border-dashed border-gray-200 p-3 text-center text-sm text-gray-500 transition-all hover:border-sky-400 hover:text-sky-600"
                  >
                    {t.officeToPdf.addMore}
                  </FileDropzone>
                </div>
              )}

              {legacyExtensions.length > 0 && (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                  <p className="text-sm text-amber-900">
                    {t.officeToPdf.legacyNote(legacyExtensions.join(', '))}
                  </p>
                </div>
              )}

              <ErrorNotice error={error} onDismiss={() => setError(null)} />

              {queue.length > 0 && (
                <fieldset disabled={busy}>
                  <legend className="mb-3 text-sm font-medium text-gray-700">
                    {t.officeToPdf.outputHeading}
                  </legend>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {outputModes.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setMode(option.id)}
                        aria-pressed={mode === option.id}
                        className={cn(
                          'rounded-2xl border p-4 text-left transition-all',
                          mode === option.id
                            ? 'border-sky-500 bg-sky-50/60 ring-2 ring-sky-500/20'
                            : 'border-gray-200 hover:border-gray-300'
                        )}
                      >
                        <span className="block font-semibold text-gray-900">{option.title}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-gray-500">
                          {option.body}
                        </span>
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}

              {queue.length > 1 && !busy && (
                <p className="flex items-start gap-2 text-xs leading-relaxed text-gray-500">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {t.officeToPdf.slowdownWarning}
                </p>
              )}

              {queue.length > 0 && !engineCached && (
                <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-5">
                  <h2 className="mb-2 font-semibold text-sky-950">{t.officeToPdf.engineTitle}</h2>
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

              {queue.length > 0 && (
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

              {queue.length > 0 && engineCached && !busy && (
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
