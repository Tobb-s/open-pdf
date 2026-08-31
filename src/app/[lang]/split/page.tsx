'use client';

import { useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { loadPdf, savePdf } from '@/lib/pdfio';
import JSZip from 'jszip';
import Navbar from '@/components/Navbar';
import ResultHeading from '@/components/ResultHeading';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import ProgressPanel from '@/components/ProgressPanel';
import { Download, FileText, Layers, Loader2, Upload, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { describeError, KnownToolError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob } from '@/lib/files';
import {
  assertFileSize,
  MAX_STRUCTURAL_BYTES,
  throwIfCancelled,
  yieldToBrowser,
} from '@/lib/limits';
import { canTrimTo, parsePageRange, splitIntoParts, summarizePages } from '@/lib/pageRange';
import { applyPageEdits } from '@/lib/pageEdits';
import {
  reportStructures,
  summarizeStructures,
  VERIFIABLE_CATEGORIES,
  type StructuralReport,
  type StructureCategory,
} from '@/lib/verify/structural';

type Result =
  | { kind: 'single'; blob: Blob; pages: number }
  | { kind: 'zip'; blob: Blob; files: number };

/** How the reader wants the document cut up. */
type Mode = 'range' | 'parts' | 'each';

/** Offered as buttons; anything else is a range away. */
const PART_CHOICES = [2, 4, 6, 8, 10] as const;

export default function SplitPage() {
  const { t, locale } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [range, setRange] = useState('');
  const [mode, setMode] = useState<Mode>('range');
  const [parts, setParts] = useState<number>(2);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const listFormat = (items: string[]) =>
    new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);

  const [result, setResult] = useState<Result | null>(null);
  /**
   * What the produced file kept, for the single-file case.
   *
   * Only the range mode gets a before/after comparison, and deliberately. Every
   * part of a ZIP is a different document, so diffing one part against the whole
   * source would report a bookmark that legitimately points into another part as
   * a loss. The ZIP modes get `partsLose` instead, built from the SOURCE.
   */
  const [report, setReport] = useState<StructuralReport | null>(null);
  /** What the source carried that no part of a ZIP can bring with it. */
  const [partsLose, setPartsLose] = useState<StructureCategory[]>([]);
  const [error, setError] = useState<ToolError | null>(null);
  const bytesRef = useRef<Uint8Array | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Parsed as the reader types, so the selection can be echoed back before they commit.
  const parsed = useMemo(
    () => (pageCount > 0 ? parsePageRange(range, pageCount) : { pages: [], invalid: [] }),
    [range, pageCount]
  );

  /** The runs the "into parts" mode would produce, shown before committing. */
  const runs = useMemo(
    () => (pageCount > 0 ? splitIntoParts(pageCount, parts) : []),
    [pageCount, parts]
  );

  const reset = () => {
    bytesRef.current = null;
    setFile(null);
    setPageCount(0);
    setRange('');
    setMode('range');
    setParts(2);
    setResult(null);
    setReport(null);
    setPartsLose([]);
    setError(null);
    setProgressPercent(0);
  };

  const selectFile = async (selected: File) => {
    reset();
    try {
      // Splitting only reads the page tree and writes it back — no page ever
      // becomes pixels — so this tool can take a file the rasterising ones
      // cannot. A scanned book is exactly the case that was being turned away.
      assertFileSize(selected, t, MAX_STRUCTURAL_BYTES);
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
      /**
       * The parsed document, made on demand.
       *
       * The range mode trims the original with `applyPageEdits`, which does its
       * own loading, so parsing here as well would cost a second full pass over
       * a book for nothing. The ZIP modes need it — they copy pages out of it —
       * and so does the repeated-page fallback.
       */
      let sourceDocument: PDFDocument | null = null;
      const openSource = async () => {
        sourceDocument ??= await loadPdf(bytes, { updateMetadata: false });
        return sourceDocument;
      };

      if (mode === 'parts') {
        const source = await openSource();
        // What the document carries that a freshly built part cannot receive.
        // Read from the source before anything is cut: each part of a ZIP is a
        // new document assembled from copied pages, and copying pages does not
        // copy a document. Naming it is the only honest thing available —
        // there is nothing to compare a part against.
        const sourceHas = summarizeStructures(source);
        const zip = new JSZip();
        const width = String(pageCount).length;

        for (const [index, run] of runs.entries()) {
          throwIfCancelled(controller.signal, t);
          setProgressPercent(((index + 1) / runs.length) * 92);
          setProgressMessage(t.split.extractingPart(index + 1, runs.length));

          const part = await PDFDocument.create();
          const wanted = Array.from({ length: run.to - run.from + 1 }, (_, n) => run.from - 1 + n);
          const copied = await part.copyPages(source, wanted);
          for (const page of copied) part.addPage(page);

          const saved = (await savePdf(part)).slice();
          const label = String(index + 1).padStart(String(runs.length).length, '0');
          const from = String(run.from).padStart(width, '0');
          const to = String(run.to).padStart(width, '0');
          zip.file(`part-${label}_pages-${from}-${to}.pdf`, saved);
          await yieldToBrowser();
        }

        setProgressMessage(t.split.packing);
        setProgressPercent(96);
        setPartsLose(
          VERIFIABLE_CATEGORIES.filter((category) => sourceHas.categories[category] > 0)
        );
        setResult({
          kind: 'zip',
          blob: await zip.generateAsync({ type: 'blob' }),
          files: runs.length,
        });
      } else if (mode === 'each') {
        const source = await openSource();
        const sourceHas = summarizeStructures(source);
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
        setPartsLose(
          VERIFIABLE_CATEGORIES.filter((category) => sourceHas.categories[category] > 0)
        );
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

        /**
         * Editing the document down rather than building a new one.
         *
         * `copyPages` into a fresh document was measured, on this project's own
         * fixture, to strip six things at once: the form, the bookmarks, the
         * attachments, the page labels, the title and the language. Asking for
         * pages 1-5 of a five-page document — the whole file — came back 25%
         * smaller with none of them. `applyPageEdits` deletes what was not
         * asked for and leaves the rest of the document alone, which keeps all
         * six.
         *
         * It cannot serve every selection, though: a page cannot be deleted
         * twice, so a range that repeats one — «1,1,2», which parsePageRange
         * allows on purpose so a reader can duplicate a page — has to fall back
         * to the old assembly. A reversed range like «5-3» is fine: it is three
         * distinct pages in a different order.
         */
        const wanted = parsed.pages.map((page) => page - 1);

        let saved: Uint8Array;
        if (!canTrimTo(parsed.pages)) {
          const source = await openSource();
          const output = await PDFDocument.create();
          const copied = await output.copyPages(source, wanted);
          for (const page of copied) output.addPage(page);
          saved = (await savePdf(output)).slice();
        } else {
          saved = await applyPageEdits(
            bytes,
            wanted.map((sourceIndex) => ({ sourceIndex, rotation: 0 }))
          );
        }

        setProgressMessage(t.split.checking);
        setProgressPercent(92);
        setReport(await reportStructures(bytes, saved));

        setResult({
          kind: 'single',
          blob: new Blob([saved as unknown as BlobPart], { type: 'application/pdf' }),
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

                <div className="space-y-5 rounded-3xl border bg-white p-6 shadow-sm">
                  <div
                    role="radiogroup"
                    aria-label={t.split.rangeLabel}
                    className="flex flex-wrap gap-2"
                  >
                    {(
                      [
                        ['range', t.split.modeRange],
                        ['parts', t.split.modeParts],
                        ['each', t.split.modeEachPage],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={mode === value}
                        onClick={() => setMode(value)}
                        className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                          mode === value
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {mode === 'range' && (
                    <div className="space-y-2">
                      <label
                        htmlFor="page-range"
                        className="block text-sm font-medium text-gray-700"
                      >
                        {t.split.rangeLabel}
                      </label>
                      <input
                        id="page-range"
                        type="text"
                        value={range}
                        onChange={(event) => setRange(event.target.value)}
                        placeholder={t.split.placeholder}
                        className="w-full rounded-xl border px-4 py-3 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-500"
                      />
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
                              parsed.invalid.map((token) => `“${token}”`).join(', '),
                              pageCount
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {mode === 'parts' && (
                    <div className="space-y-3">
                      <span className="block text-sm font-medium text-gray-700">
                        {t.split.partsLabel}
                      </span>
                      <div role="radiogroup" aria-label={t.split.partsLabel} className="flex flex-wrap gap-2">
                        {PART_CHOICES.map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            role="radio"
                            aria-checked={parts === choice}
                            onClick={() => setParts(choice)}
                            className={`min-w-14 rounded-xl px-4 py-2 text-sm font-semibold tabular-nums transition-colors ${
                              parts === choice
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            {choice}
                          </button>
                        ))}
                      </div>
                      {/* Worked out before committing, from the real page count. */}
                      {runs.length > 0 && (
                        <div className="space-y-1 text-xs">
                          <p className="text-emerald-700">
                            {t.split.partsNote(
                              runs.length,
                              runs
                                .map((run) =>
                                  run.from === run.to
                                    ? `${run.from}`
                                    : `${run.from}–${run.to}`
                                )
                                .join(', ')
                            )}
                          </p>
                          {runs.length < parts && (
                            <p className="text-amber-700">{t.split.partsTooMany(pageCount)}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {mode === 'each' && (
                    <p className="flex items-center gap-2 text-xs text-blue-600">
                      <Layers className="h-4 w-4 shrink-0" />
                      {t.split.eachPageNote(pageCount)}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={split}
                    disabled={isProcessing || (mode === 'range' && parsed.pages.length === 0)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-bold text-white transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 sm:w-auto"
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

                <ErrorNotice error={error} onDismiss={() => setError(null)} />

                {isProcessing && mode !== 'range' && (
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
            <ResultHeading className="mb-2 text-2xl font-bold">
              {result.kind === 'zip'
                ? t.split.doneZip(result.files)
                : t.split.doneSingle(result.pages)}
            </ResultHeading>
            <p className="mb-4 text-gray-600">{t.split.doneBody}</p>

            {report?.signatureBroken && (
              <p className="mx-auto mb-4 max-w-lg rounded-2xl border border-red-200 bg-red-50 p-4 text-left text-sm text-red-900">
                {t.common.signatureBroken}
              </p>
            )}

            {result.kind === 'zip' && partsLose.length > 0 && (
              /* Not a comparison: each part is its own document and there is
                 nothing to compare it against. What the SOURCE carried, and
                 what no part can bring with it. */
              <div className="mx-auto mb-8 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">
                {t.split.partsLoseNote(
                  listFormat(partsLose.map((category) => t.structures[category]))
                )}
              </div>
            )}

            {result.kind === 'single' && report && report.losses.length > 0 ? (
              <div className="mx-auto mb-8 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">
                {t.split.lostNote(
                  listFormat(report.losses.map((loss) => t.structures[loss.category]))
                )}
              </div>
            ) : result.kind === 'single' && report && report.present.length > 0 ? (
              <p className="mb-8 text-sm text-gray-500">
                {t.split.keptNote(
                  listFormat(report.present.map((category) => t.structures[category]))
                )}
              </p>
            ) : (
              <div className="mb-4" />
            )}
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
