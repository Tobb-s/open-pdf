'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { loadPdf, savePdf } from '@/lib/pdfio';
import JSZip from 'jszip';
import Navbar from '@/components/Navbar';
import ResultHeading from '@/components/ResultHeading';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import ProgressPanel from '@/components/ProgressPanel';
import {
  Check,
  CheckCircle2,
  Download,
  FileText,
  Layers,
  LayoutGrid,
  Loader2,
  Type,
  Upload,
  X,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { describeError, KnownToolError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob, formatBytes } from '@/lib/files';
import {
  assertFileSize,
  MAX_STRUCTURAL_BYTES,
  throwIfCancelled,
  yieldToBrowser,
} from '@/lib/limits';
import {
  canTrimTo,
  parsePageRange,
  splitByTargetSize,
  splitIntoParts,
  summarizePages,
} from '@/lib/pageRange';
import { openPdf, renderPageToJpeg } from '@/lib/pdfjs';
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
type Mode = 'range' | 'parts' | 'each' | 'size';

/** Offered as buttons; anything else is a range away. */
const PART_CHOICES = [2, 4, 6, 8, 10] as const;
const SIZE_CHOICES = [5, 10, 25] as const;

export default function SplitPage() {
  const { t, locale } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [range, setRange] = useState('');
  const [mode, setMode] = useState<Mode>('range');
  const [parts, setParts] = useState<number>(2);
  const [maxSizeMb, setMaxSizeMb] = useState<number>(10);
  const [rangeView, setRangeView] = useState<'visual' | 'text'>('visual');
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [loadingThumbnails, setLoadingThumbnails] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const listFormat = (items: string[]) =>
    new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);

  const [result, setResult] = useState<Result | null>(null);
  const [report, setReport] = useState<StructuralReport | null>(null);
  const [partsLose, setPartsLose] = useState<StructureCategory[]>([]);
  const [error, setError] = useState<ToolError | null>(null);
  const bytesRef = useRef<Uint8Array | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Parsed as the reader types, so the selection can be echoed back before they commit.
  const parsed = useMemo(
    () => (pageCount > 0 ? parsePageRange(range, pageCount) : { pages: [], invalid: [] }),
    [range, pageCount]
  );

  const selectedSet = useMemo(() => new Set(parsed.pages), [parsed.pages]);

  /** The runs the "into parts" mode would produce, shown before committing. */
  const runs = useMemo(
    () => (pageCount > 0 ? splitIntoParts(pageCount, parts) : []),
    [pageCount, parts]
  );

  /** The runs the "by size" mode would produce. */
  const sizeRuns = useMemo(() => {
    if (pageCount === 0 || !file) return [];
    return splitByTargetSize(pageCount, file.size, maxSizeMb * 1024 * 1024);
  }, [pageCount, file, maxSizeMb]);

  // Load preview thumbnails for the visual page selector
  useEffect(() => {
    if (!bytesRef.current || pageCount === 0) return;
    let active = true;

    async function loadPreviews() {
      setLoadingThumbnails(true);
      try {
        const opened = await openPdf(bytesRef.current!);
        const count = Math.min(opened.document.numPages, 60);
        for (let p = 1; p <= count; p++) {
          if (!active) break;
          const page = await opened.document.getPage(p);
          const { blob } = await renderPageToJpeg(page, 0.25, 0.7);
          page.cleanup();
          const url = URL.createObjectURL(blob);
          if (!active) {
            URL.revokeObjectURL(url);
            break;
          }
          setThumbnails((prev) => ({ ...prev, [p]: url }));
        }
        await opened.destroy().catch(() => {});
      } catch {
        // Non-blocking thumbnail generation
      } finally {
        if (active) setLoadingThumbnails(false);
      }
    }

    loadPreviews();
    return () => {
      active = false;
    };
  }, [file, pageCount]);

  const reset = () => {
    for (const url of Object.values(thumbnails)) {
      URL.revokeObjectURL(url);
    }
    setThumbnails({});
    bytesRef.current = null;
    setFile(null);
    setPageCount(0);
    setRange('');
    setMode('range');
    setParts(2);
    setMaxSizeMb(10);
    setResult(null);
    setReport(null);
    setPartsLose([]);
    setError(null);
    setProgressPercent(0);
  };

  const selectFile = async (selected: File) => {
    reset();
    try {
      assertFileSize(selected, t, MAX_STRUCTURAL_BYTES);
      const bytes = new Uint8Array(await selected.arrayBuffer());
      const document_ = await loadPdf(bytes, { updateMetadata: false });
      bytesRef.current = bytes;
      setFile(selected);
      setPageCount(document_.getPageCount());
      // Default visual selection: all pages
      setRange(`1-${document_.getPageCount()}`);
    } catch (caught) {
      setError(describeError(caught, t));
    }
  };

  // Quick selection helpers
  const selectAll = () => {
    if (pageCount === 0) return;
    setRange(`1-${pageCount}`);
  };

  const selectNone = () => {
    setRange('');
  };

  const selectEven = () => {
    const evens: number[] = [];
    for (let i = 2; i <= pageCount; i += 2) evens.push(i);
    setRange(summarizePages(evens));
  };

  const selectOdd = () => {
    const odds: number[] = [];
    for (let i = 1; i <= pageCount; i += 2) odds.push(i);
    setRange(summarizePages(odds));
  };

  const invertSelection = () => {
    const inverted: number[] = [];
    for (let i = 1; i <= pageCount; i++) {
      if (!selectedSet.has(i)) inverted.push(i);
    }
    setRange(summarizePages(inverted));
  };

  const togglePage = (p: number) => {
    const nextSet = new Set(parsed.pages);
    if (nextSet.has(p)) {
      nextSet.delete(p);
    } else {
      nextSet.add(p);
    }
    const sorted = [...nextSet].sort((a, b) => a - b);
    setRange(summarizePages(sorted));
  };

  const split = async () => {
    const bytes = bytesRef.current;
    if (!bytes || !file) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setIsProcessing(true);
    setError(null);
    setResult(null);
    setReport(null);
    setPartsLose([]);

    try {
      let sourceDocument: PDFDocument | null = null;
      const openSource = async () => {
        sourceDocument ??= await loadPdf(bytes, { updateMetadata: false });
        return sourceDocument;
      };

      if (mode === 'parts') {
        const source = await openSource();
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
      } else if (mode === 'size') {
        const source = await openSource();
        const sourceHas = summarizeStructures(source);
        const zip = new JSZip();
        const width = String(pageCount).length;

        for (const [index, run] of sizeRuns.entries()) {
          throwIfCancelled(controller.signal, t);
          setProgressPercent(((index + 1) / sizeRuns.length) * 92);
          setProgressMessage(t.split.extractingPart(index + 1, sizeRuns.length));

          const part = await PDFDocument.create();
          const wanted = Array.from({ length: run.to - run.from + 1 }, (_, n) => run.from - 1 + n);
          const copied = await part.copyPages(source, wanted);
          for (const page of copied) part.addPage(page);

          const saved = (await savePdf(part)).slice();
          const label = String(index + 1).padStart(String(sizeRuns.length).length, '0');
          const from = String(run.from).padStart(width, '0');
          const to = String(run.to).padStart(width, '0');
          zip.file(`parte-${label}_paginas-${from}-${to}.pdf`, saved);
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
          files: sizeRuns.length,
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
        setProgressPercent(88);
        const report = await reportStructures(bytes, saved);
        setReport(report);

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
          <p className="mx-auto max-w-xl text-gray-600">{t.split.intro}</p>
        </div>

        {!result ? (
          <div className="space-y-8">
            {!file ? (
              <>
                <FileDropzone
                  inputId="split-file-input"
                  kind={PDF_FILES}
                  onFilesSelected={([selected]) => selectFile(selected)}
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
                    <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-600">
                      {formatBytes(file.size)}
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
                  {/* Mode Selector Tabs */}
                  <div
                    role="radiogroup"
                    aria-label={t.split.rangeLabel}
                    className="flex flex-wrap gap-2"
                  >
                    {(
                      [
                        ['range', t.split.modeRange],
                        ['parts', t.split.modeParts],
                        ['size', t.split.modeSize],
                        ['each', t.split.modeEachPage],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={mode === value}
                        onClick={() => setMode(value)}
                        className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                          mode === value
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Mode 1: Range (with Visual Selector & Text Input) */}
                  {mode === 'range' && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                        <span className="text-sm font-semibold text-gray-900">
                          {t.split.rangeLabel}
                        </span>
                        <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 text-xs font-medium">
                          <button
                            type="button"
                            onClick={() => setRangeView('visual')}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 transition-all ${
                              rangeView === 'visual'
                                ? 'bg-white font-semibold text-blue-600 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                            }`}
                          >
                            <LayoutGrid className="h-3.5 w-3.5" />
                            {t.split.visualView}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRangeView('text')}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 transition-all ${
                              rangeView === 'text'
                                ? 'bg-white font-semibold text-blue-600 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                            }`}
                          >
                            <Type className="h-3.5 w-3.5" />
                            {t.split.textView}
                          </button>
                        </div>
                      </div>

                      {rangeView === 'visual' ? (
                        <div className="space-y-3">
                          {/* Quick selection toolbar */}
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={selectAll}
                              className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                            >
                              {t.split.selectAll}
                            </button>
                            <button
                              type="button"
                              onClick={selectNone}
                              className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                            >
                              {t.split.selectNone}
                            </button>
                            <button
                              type="button"
                              onClick={selectEven}
                              className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                            >
                              {t.split.selectEven}
                            </button>
                            <button
                              type="button"
                              onClick={selectOdd}
                              className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                            >
                              {t.split.selectOdd}
                            </button>
                            <button
                              type="button"
                              onClick={invertSelection}
                              className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                            >
                              {t.split.invertSelection}
                            </button>
                            {loadingThumbnails && (
                              <span className="flex items-center gap-1 text-xs text-gray-400">
                                <Loader2 className="h-3 w-3 animate-spin" /> Cargando miniaturas…
                              </span>
                            )}
                          </div>

                          {/* Visual thumbnail grid */}
                          <div className="grid max-h-96 grid-cols-3 gap-3 overflow-y-auto rounded-2xl border bg-gray-50/50 p-3 sm:grid-cols-4 md:grid-cols-6">
                            {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => {
                              const isSelected = selectedSet.has(p);
                              const thumb = thumbnails[p];

                              return (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => togglePage(p)}
                                  className={`group relative flex flex-col items-center justify-between rounded-xl border p-2 transition-all ${
                                    isSelected
                                      ? 'border-blue-600 bg-blue-50/40 shadow-sm ring-2 ring-blue-500/20'
                                      : 'border-gray-200 bg-white opacity-70 hover:opacity-100 hover:border-gray-300'
                                  }`}
                                >
                                  <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-gray-100 flex items-center justify-center">
                                    {thumb ? (
                                      /* eslint-disable-next-line @next/next/no-img-element */
                                      <img
                                        src={thumb}
                                        alt={`Página ${p}`}
                                        className="h-full w-full object-contain"
                                      />
                                    ) : (
                                      <FileText className="h-8 w-8 text-gray-300" />
                                    )}
                                    <div
                                      className={`absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full transition-colors ${
                                        isSelected
                                          ? 'bg-blue-600 text-white'
                                          : 'bg-white/80 text-gray-400 border border-gray-200'
                                      }`}
                                    >
                                      {isSelected ? (
                                        <Check className="h-3 w-3 stroke-[3]" />
                                      ) : null}
                                    </div>
                                  </div>
                                  <span className="mt-1.5 text-xs font-semibold text-gray-700">
                                    {p}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <input
                            id="page-range"
                            type="text"
                            value={range}
                            onChange={(event) => setRange(event.target.value)}
                            placeholder={t.split.placeholder}
                            className="w-full rounded-xl border px-4 py-3 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-500"
                          />
                          <p className="text-xs text-gray-500">{t.split.syntaxNote}</p>
                        </div>
                      )}

                      <div className="space-y-1 text-xs">
                        {parsed.pages.length > 0 && (
                          <p className="font-medium text-emerald-700">
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

                  {/* Mode 2: Equal Parts */}
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

                  {/* Mode 3: Split by Target Size */}
                  {mode === 'size' && (
                    <div className="space-y-3">
                      <span className="block text-sm font-medium text-gray-700">
                        {t.split.sizeLabel}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        {SIZE_CHOICES.map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            onClick={() => setMaxSizeMb(choice)}
                            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                              maxSizeMb === choice
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            {t.split.sizePreset(choice)}
                          </button>
                        ))}
                        <div className="flex items-center gap-1.5 rounded-xl border bg-gray-50 px-3 py-1.5 text-sm">
                          <input
                            type="number"
                            min="1"
                            max="500"
                            value={maxSizeMb}
                            onChange={(e) => setMaxSizeMb(Math.max(1, Number(e.target.value) || 1))}
                            className="w-16 bg-transparent text-center font-bold text-gray-800 outline-none"
                          />
                          <span className="text-gray-500 font-medium">MB</span>
                        </div>
                      </div>
                      {sizeRuns.length > 0 && (
                        <div className="space-y-1 text-xs">
                          <p className="text-emerald-700 font-medium">
                            {t.split.sizeNote(sizeRuns.length, maxSizeMb)}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Mode 4: One per page */}
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
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-bold text-white transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 sm:w-auto shadow-md shadow-blue-200"
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

                {isProcessing && (
                  <ProgressPanel
                    message={progressMessage}
                    percent={progressPercent}
                    onCancel={() => abortRef.current?.abort()}
                  />
                )}
                <ErrorNotice error={error} onDismiss={() => setError(null)} />
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-3xl border bg-white p-12 text-center shadow-sm">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-600">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <ResultHeading className="mb-2 text-2xl font-bold">
              {result.kind === 'zip'
                ? t.split.doneZip(result.files)
                : t.split.doneSingle(result.pages)}
            </ResultHeading>
            <p className="mb-6 text-gray-600">{t.split.doneBody}</p>

            {report && report.present.length > 0 && (
              <div className="mx-auto mb-4 max-w-lg rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left text-sm text-emerald-900">
                <p className="font-semibold text-emerald-950">
                  {t.split.keptNote(listFormat(report.present.map((c) => t.structures[c])))}
                </p>
              </div>
            )}

            {partsLose.length > 0 && (
              <div className="mx-auto mb-4 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">
                <p>
                  {t.split.partsLoseNote(
                    listFormat(partsLose.map((c) => t.structures[c]))
                  )}
                </p>
              </div>
            )}

            {report && report.losses.length > 0 && (
              <div className="mx-auto mb-6 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">
                <p className="font-semibold text-amber-950">
                  {t.split.lostNote(listFormat(report.losses.map((l) => t.structures[l.category])))}
                </p>
              </div>
            )}

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  if (!file) return;
                  if (result.kind === 'zip') {
                    downloadBlob(result.blob, derivedFileName(file.name, '.zip'));
                  } else {
                    downloadBlob(result.blob, derivedFileName(file.name, '_split.pdf'));
                  }
                }}
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
