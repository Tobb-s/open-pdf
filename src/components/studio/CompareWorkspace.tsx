'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pixelmatch from 'pixelmatch';
import {
  ArrowLeft,
  Download,
  Equal,
  FileDiff,
  FilePlus2,
  Loader2,
  Minus,
  MoveRight,
  Plus,
  RefreshCw,
  Upload,
} from 'lucide-react';
import ErrorNotice from '@/components/ErrorNotice';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import { useI18n } from '@/lib/i18n/context';
import { describeError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob } from '@/lib/files';
import { assertFileSize, MAX_EDITABLE_BYTES, yieldToBrowser } from '@/lib/limits';
import { openPdf, renderPageToCanvas, type OpenPdfResult } from '@/lib/pdfjs';
import {
  comparePageText,
  type ComparisonPage,
  type ComparisonReport,
  type ComparisonStatus,
  type PageDifference,
} from '@/lib/studio/compare';
import { visualHash } from '@/lib/studio/visualCompare';

interface CompareWorkspaceProps {
  baseDocument: PDFDocumentProxy | null;
  baseName: string;
  onClose: () => void;
}

const STATUS_ICONS = {
  unchanged: Equal,
  modified: RefreshCw,
  moved: MoveRight,
  added: Plus,
  removed: Minus,
} satisfies Record<ComparisonStatus, typeof Equal>;

const STATUS_CLASSES: Record<ComparisonStatus, string> = {
  unchanged: 'bg-gray-100 text-gray-700',
  modified: 'bg-amber-100 text-amber-900',
  moved: 'bg-blue-100 text-blue-900',
  added: 'bg-emerald-100 text-emerald-900',
  removed: 'bg-red-100 text-red-900',
};

async function extractPages(
  pdf: PDFDocumentProxy,
  onPage: () => void
): Promise<ComparisonPage[]> {
  const pages: ComparisonPage[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    try {
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(0.3, 160 / Math.max(viewport.width, viewport.height));
      const canvas = document.createElement('canvas');
      await renderPageToCanvas(page, canvas, scale);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      pages.push({
        page: number,
        text: content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
        visualHash: context
          ? visualHash({ data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height })
          : undefined,
      });
      canvas.width = 0;
      canvas.height = 0;
    } finally {
      page.cleanup();
    }
    onPage();
    if (number % 4 === 0) await yieldToBrowser();
  }
  return pages;
}

function VisualDifference({
  baseDocument,
  comparisonDocument,
  difference,
}: {
  baseDocument: PDFDocumentProxy;
  comparisonDocument: PDFDocumentProxy;
  difference: PageDifference;
}) {
  const { t } = useI18n();
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const comparisonCanvasRef = useRef<HTMLCanvasElement>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement>(null);
  const [changedPixels, setChangedPixels] = useState<number | null>(null);

  useEffect(() => {
    if (difference.basePage === null || difference.comparisonPage === null) return;
    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      const [basePage, comparisonPage] = await Promise.all([
        baseDocument.getPage(difference.basePage!),
        comparisonDocument.getPage(difference.comparisonPage!),
      ]);
      try {
        const [baseViewport, comparisonViewport] = [
          basePage.getViewport({ scale: 1 }),
          comparisonPage.getViewport({ scale: 1 }),
        ];
        const scale = Math.min(
          1.5,
          640 / Math.max(baseViewport.width, baseViewport.height, comparisonViewport.width, comparisonViewport.height)
        );
        const baseSource = document.createElement('canvas');
        const comparisonSource = document.createElement('canvas');
        const [baseRendered, comparisonRendered] = await Promise.all([
          renderPageToCanvas(basePage, baseSource, scale, { signal: controller.signal }),
          renderPageToCanvas(comparisonPage, comparisonSource, scale, { signal: controller.signal }),
        ]);
        if (cancelled) return;

        const width = Math.max(baseRendered.width, comparisonRendered.width);
        const height = Math.max(baseRendered.height, comparisonRendered.height);
        const prepare = (target: HTMLCanvasElement | null, source: HTMLCanvasElement) => {
          if (!target) return null;
          target.width = width;
          target.height = height;
          const context = target.getContext('2d', { willReadFrequently: true });
          if (!context) return null;
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, width, height);
          context.drawImage(source, (width - source.width) / 2, (height - source.height) / 2);
          return context;
        };
        const baseContext = prepare(baseCanvasRef.current, baseSource);
        const comparisonContext = prepare(comparisonCanvasRef.current, comparisonSource);
        const diffCanvas = diffCanvasRef.current;
        if (!baseContext || !comparisonContext || !diffCanvas) return;
        diffCanvas.width = width;
        diffCanvas.height = height;
        const diffContext = diffCanvas.getContext('2d');
        if (!diffContext) return;
        const output = diffContext.createImageData(width, height);
        const changed = pixelmatch(
          baseContext.getImageData(0, 0, width, height).data,
          comparisonContext.getImageData(0, 0, width, height).data,
          output.data,
          width,
          height,
          { threshold: 0.1, includeAA: false, alpha: 0.55, diffColor: [220, 38, 38] }
        );
        diffContext.putImageData(output, 0, 0);
        setChangedPixels((changed / (width * height)) * 100);
      } finally {
        basePage.cleanup();
        comparisonPage.cleanup();
      }
    })().catch(() => {
      if (!cancelled) setChangedPixels(null);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [baseDocument, comparisonDocument, difference]);

  if (difference.basePage === null || difference.comparisonPage === null) {
    return <p className="py-10 text-center text-sm text-gray-600">{t.studio.compareSinglePage}</p>;
  }

  return (
    <section className="space-y-3" aria-labelledby="compare-visual-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="compare-visual-heading" className="text-sm font-semibold text-gray-900">
          {t.studio.compareVisual}
        </h3>
        <span className="text-xs tabular-nums text-gray-600">
          {changedPixels === null ? t.studio.compareRendering : t.studio.comparePixels(changedPixels.toFixed(2))}
        </span>
      </div>
      <div className="grid min-w-0 gap-3 xl:grid-cols-3">
        {[
          [t.studio.compareOriginal, baseCanvasRef],
          [t.studio.compareReference, comparisonCanvasRef],
          [t.studio.comparePixelMap, diffCanvasRef],
        ].map(([label, ref]) => (
          <figure key={label as string} className="min-w-0 space-y-1">
            <figcaption className="text-xs font-medium text-gray-600">{label as string}</figcaption>
            <div className="flex min-h-52 items-center justify-center overflow-auto border bg-gray-100 p-2">
              <canvas ref={ref as React.RefObject<HTMLCanvasElement>} className="max-h-[34rem] max-w-full bg-white shadow-sm" />
            </div>
          </figure>
        ))}
      </div>
    </section>
  );
}

export default function CompareWorkspace({ baseDocument, baseName, onClose }: CompareWorkspaceProps) {
  const { t } = useI18n();
  const openedRef = useRef<OpenPdfResult | null>(null);
  const [comparisonDocument, setComparisonDocument] = useState<PDFDocumentProxy | null>(null);
  const [comparisonName, setComparisonName] = useState('');
  const [report, setReport] = useState<ComparisonReport | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<ToolError | null>(null);

  useEffect(() => () => {
    void openedRef.current?.destroy().catch(() => {});
  }, []);

  const compareFile = async (file: File) => {
    if (!baseDocument) return;
    setBusy(true);
    setError(null);
    setReport(null);
    setSelectedId(null);
    try {
      assertFileSize(file, t, MAX_EDITABLE_BYTES);
      const opened = await openPdf(await file.arrayBuffer());
      await openedRef.current?.destroy().catch(() => {});
      openedRef.current = opened;
      setComparisonDocument(opened.document);
      setComparisonName(file.name);
      let current = 0;
      const total = baseDocument.numPages + opened.document.numPages;
      setProgress({ current, total });
      const onPage = () => {
        current += 1;
        setProgress({ current, total });
      };
      const basePages = await extractPages(baseDocument, onPage);
      const comparisonPages = await extractPages(opened.document, onPage);
      const next = comparePageText(basePages, comparisonPages);
      setReport(next);
      setSelectedId(next.differences.find((item) => item.status !== 'unchanged')?.id ?? next.differences[0]?.id ?? null);
    } catch (caught) {
      setError(describeError(caught, t));
    } finally {
      setBusy(false);
    }
  };

  const selected = report?.differences.find((item) => item.id === selectedId) ?? null;
  const statusLabels: Record<ComparisonStatus, string> = {
    unchanged: t.studio.compareUnchanged,
    modified: t.studio.compareModified,
    moved: t.studio.compareMoved,
    added: t.studio.compareAdded,
    removed: t.studio.compareRemoved,
  };

  const downloadReport = () => {
    if (!report) return;
    const payload = { baseFile: baseName, comparisonFile: comparisonName, ...report };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      derivedFileName(baseName, '_comparison.json')
    );
  };

  return (
    <section className="min-w-0 space-y-5" aria-labelledby="compare-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <FileDiff className="h-5 w-5 shrink-0 text-violet-700" />
          <div className="min-w-0">
            <h2 id="compare-heading" className="text-lg font-semibold text-gray-950">{t.studio.compareHeading}</h2>
            <p className="truncate text-sm text-gray-600">{baseName}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <ArrowLeft className="h-4 w-4" /> {t.studio.compareBack}
        </button>
      </div>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {!report && !busy && (
        <FileDropzone
          inputId="studio-compare-file"
          kind={PDF_FILES}
          className="flex min-h-64 cursor-pointer flex-col items-center justify-center border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center hover:border-violet-400 hover:bg-violet-50/30"
          onFilesSelected={(files) => {
            if (files[0]) void compareFile(files[0]);
          }}
        >
          <Upload className="h-8 w-8 text-violet-600" />
          <p className="mt-3 font-semibold text-gray-900">{t.studio.compareChoose}</p>
          <p className="mt-1 max-w-xl text-sm text-gray-600">{t.studio.comparePrivacy}</p>
        </FileDropzone>
      )}

      {busy && (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
          <p className="text-sm font-medium text-gray-800">{t.studio.compareReading(progress.current, progress.total)}</p>
        </div>
      )}

      {report && comparisonDocument && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-sm text-gray-700">
              <FilePlus2 className="h-4 w-4 shrink-0 text-violet-600" />
              <span className="truncate">{comparisonName}</span>
            </div>
            <div className="flex gap-2">
              <FileDropzone
                inputId="studio-compare-replace"
                kind={PDF_FILES}
                className="cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onFilesSelected={(files) => {
                  if (files[0]) void compareFile(files[0]);
                }}
              >
                <span className="flex items-center gap-2"><RefreshCw className="h-4 w-4" /> {t.studio.compareAnother}</span>
              </FileDropzone>
              <button
                type="button"
                onClick={downloadReport}
                title={t.studio.compareDownload}
                className="flex items-center gap-2 rounded-lg bg-violet-700 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-800"
              >
                <Download className="h-4 w-4" /> {t.studio.compareDownload}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px border bg-gray-200 sm:grid-cols-5" aria-label={t.studio.compareSummary}>
            {(Object.keys(report.summary) as ComparisonStatus[]).map((status) => {
              const Icon = STATUS_ICONS[status];
              return (
                <div
                  key={status}
                  className={`flex items-center gap-2 bg-white px-3 py-3 ${status === 'removed' ? 'col-span-2 sm:col-span-1' : ''}`}
                >
                  <Icon className="h-4 w-4 text-gray-500" />
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-gray-950">{report.summary[status]}</p>
                    <p className="text-xs text-gray-600">{statusLabels[status]}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid min-w-0 gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
            <nav className="max-h-[48rem] overflow-auto border" aria-label={t.studio.comparePages}>
              {report.differences.map((difference) => {
                const Icon = STATUS_ICONS[difference.status];
                return (
                  <button
                    key={difference.id}
                    type="button"
                    aria-current={selectedId === difference.id ? 'true' : undefined}
                    onClick={() => setSelectedId(difference.id)}
                    className={`flex w-full items-start gap-3 border-b px-3 py-3 text-left last:border-b-0 ${
                      selectedId === difference.id ? 'bg-violet-50' : 'bg-white hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-gray-900">
                        {t.studio.comparePagePair(difference.basePage, difference.comparisonPage)}
                      </span>
                      <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASSES[difference.status]}`}>
                        {statusLabels[difference.status]}
                      </span>
                    </span>
                  </button>
                );
              })}
            </nav>

            {selected && (
              <div className="min-w-0 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-gray-950">
                      {t.studio.comparePagePair(selected.basePage, selected.comparisonPage)}
                    </h3>
                    <p className="mt-1 text-xs text-gray-600">
                      {t.studio.compareWordSummary(selected.addedWords, selected.removedWords)}
                    </p>
                  </div>
                  <span className={`rounded px-2 py-1 text-xs font-medium ${STATUS_CLASSES[selected.status]}`}>
                    {statusLabels[selected.status]}
                  </span>
                </div>

                <VisualDifference
                  key={selected.id}
                  baseDocument={baseDocument!}
                  comparisonDocument={comparisonDocument}
                  difference={selected}
                />

                <section className="space-y-2" aria-labelledby="compare-text-heading">
                  <h3 id="compare-text-heading" className="text-sm font-semibold text-gray-900">
                    {t.studio.compareText}
                  </h3>
                  <div className="max-h-64 overflow-auto border bg-white p-4 text-sm leading-7 text-gray-800">
                    {selected.changes.map((change, index) => (
                      <span
                        key={`${change.kind}-${index}`}
                        className={
                          change.kind === 'added'
                            ? 'bg-emerald-200 text-emerald-950'
                            : change.kind === 'removed'
                              ? 'bg-red-200 text-red-950 line-through'
                              : undefined
                        }
                      >
                        {change.text}
                        {change.kind === 'removed' && selected.changes[index + 1]?.kind === 'added' ? ' ' : ''}
                      </span>
                    ))}
                    {selected.changes.length === 0 && <span className="text-gray-500">{t.studio.compareNoText}</span>}
                  </div>
                </section>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
