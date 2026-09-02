'use client';

import { useMemo, useRef, useState } from 'react';
import Navbar from '@/components/Navbar';
import ResultHeading from '@/components/ResultHeading';
import FileDropzone, { MARKDOWN_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import ProgressPanel from '@/components/ProgressPanel';
import {
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  FileCode2,
  FilePlus2,
  FileText,
  ListOrdered,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { describeError, type ToolError } from '@/lib/errors';
import { downloadBlob, formatBytes } from '@/lib/files';
import { assertFileSize, throwIfCancelled, yieldToBrowser } from '@/lib/limits';
import {
  mergeMarkdownFiles,
  type MarkdownFileItem,
  type MergeSeparatorStyle,
  countMarkdownStats,
} from '@/lib/markdown/merge';
import {
  renderMarkdownToPdf,
  type PageSizeName,
  type TypographyTheme,
} from '@/lib/markdown/pdfRenderer';

interface ProcessResult {
  blob: Blob;
  filename: string;
  kind: 'md' | 'pdf';
  pages?: number;
  filesCount: number;
  wordsCount: number;
}

export default function MarkdownPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<MarkdownFileItem[]>([]);
  const [activeTab, setActiveTab] = useState<'files' | 'preview' | 'settings'>('files');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<ToolError | null>(null);

  // Settings
  const [pageSize, setPageSize] = useState<PageSizeName>('A4');
  const [theme, setTheme] = useState<TypographyTheme>('sans');
  const [pageBreakPerFile, setPageBreakPerFile] = useState(true);
  const [showPageNumbers, setShowPageNumbers] = useState(true);
  const [separator, setSeparator] = useState<MergeSeparatorStyle>('both');

  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);

  const addFiles = async (files: File[]) => {
    setError(null);
    const newItems: MarkdownFileItem[] = [];

    for (const file of files) {
      assertFileSize(file, t);
      const text = await file.text();
      newItems.push({
        id: String(nextId.current++),
        name: file.name,
        content: text,
        size: file.size,
      });
    }

    setItems((prev) => [...prev, ...newItems]);
  };

  const move = (index: number, direction: -1 | 1) => {
    setItems((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  };

  const remove = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Compute merged markdown and statistics
  const { content: mergedText, stats: mergedStats } = useMemo(() => {
    return mergeMarkdownFiles(items, { separator, addTitleHeading: true });
  }, [items, separator]);

  // Merge and download as unified .md file
  const handleMergeMd = async () => {
    if (items.length === 0) return;
    setIsProcessing(true);
    setProgressPercent(20);
    setProgressMessage(t.markdown.workingMerge);
    setError(null);

    try {
      await yieldToBrowser();
      setProgressPercent(80);

      const blob = new Blob([mergedText], { type: 'text/markdown;charset=utf-8' });
      const filename = items.length === 1 ? items[0].name : 'markdown_unificado.md';

      setProgressPercent(100);
      setResult({
        blob,
        filename,
        kind: 'md',
        filesCount: items.length,
        wordsCount: mergedStats.totalWords,
      });
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setIsProcessing(false);
    }
  };

  // Convert to unified Vector PDF
  const handleConvertToPdf = async () => {
    if (items.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setIsProcessing(true);
    setProgressPercent(15);
    setProgressMessage(t.markdown.workingPdf);
    setError(null);

    try {
      throwIfCancelled(controller.signal, t);
      await yieldToBrowser();

      setProgressPercent(40);
      const pdfDocs = items.map((it) => ({ name: it.name, content: it.content }));

      const pdfBytes = await renderMarkdownToPdf(pdfDocs, {
        pageSize,
        theme,
        pageBreakPerFile: items.length > 1 ? pageBreakPerFile : false,
        showPageNumbers,
        documentTitle: items.length === 1 ? items[0].name.replace(/\.md$/i, '') : 'OpenPDF Markdown',
      });

      throwIfCancelled(controller.signal, t);
      setProgressPercent(90);

      const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
      const filename = items.length === 1 ? items[0].name.replace(/\.md$/i, '.pdf') : 'documento_markdown.pdf';

      // Load with pdf-lib to count final pages
      const { PDFDocument } = await import('pdf-lib');
      const loaded = await PDFDocument.load(pdfBytes);
      const pages = loaded.getPageCount();

      setProgressPercent(100);
      setResult({
        blob,
        filename,
        kind: 'pdf',
        pages,
        filesCount: items.length,
        wordsCount: mergedStats.totalWords,
      });
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <header className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <Sparkles className="h-3.5 w-3.5" />
            {t.markdown.badge}
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-950 sm:text-4xl">
            {t.markdown.heading}
          </h1>
          <p className="mt-2 text-base text-gray-600 sm:text-lg">{t.markdown.intro}</p>
        </header>

        {error && (
          <div className="mb-6">
            <ErrorNotice error={error} onDismiss={() => setError(null)} />
          </div>
        )}

        {result ? (
          <div className="rounded-3xl border border-gray-100 bg-gray-50/70 p-8 text-center sm:p-12">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
              {result.kind === 'pdf' ? <FileText className="h-8 w-8" /> : <FileCode2 className="h-8 w-8" />}
            </div>

            <ResultHeading>
              {result.kind === 'pdf' ? t.markdown.donePdfTitle : t.markdown.doneMergeTitle}
            </ResultHeading>

            <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
              {result.kind === 'pdf'
                ? t.markdown.donePdfBody(result.pages ?? 1)
                : t.markdown.doneMergeBody(result.filesCount, result.wordsCount)}
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => downloadBlob(result.blob, result.filename)}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
              >
                <Download className="h-5 w-5" />
                {result.kind === 'pdf' ? t.markdown.downloadPdf : t.markdown.downloadMergedMd}
              </button>

              <button
                type="button"
                onClick={() => setResult(null)}
                className="rounded-xl border border-gray-200 bg-white px-5 py-3.5 text-base font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                {t.markdown.another}
              </button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <FileDropzone
            inputId="markdown-files"
            kind={MARKDOWN_FILES}
            multiple
            onFilesSelected={addFiles}
            className="flex min-h-[300px] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-8 text-center transition-colors hover:border-emerald-400 hover:bg-emerald-50/20"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
              <FileCode2 className="h-8 w-8" />
            </div>
            <p className="mt-4 text-base font-bold text-gray-900">{t.markdown.dropLabel}</p>
            <p className="mt-1 text-sm text-gray-500">{t.markdown.dropHint}</p>
          </FileDropzone>
        ) : (
          <div className="space-y-6">
            {/* Top Toolbar: Tabs and Stats */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-1 rounded-2xl border border-gray-200 bg-gray-50 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('files')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors',
                    activeTab === 'files' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  )}
                >
                  <ListOrdered className="h-4 w-4" />
                  {t.markdown.tabFiles} ({items.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('preview')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors',
                    activeTab === 'preview' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  )}
                >
                  <Eye className="h-4 w-4" />
                  {t.markdown.tabPreview}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('settings')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors',
                    activeTab === 'settings' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  )}
                >
                  <Settings className="h-4 w-4" />
                  {t.markdown.tabSettings}
                </button>
              </div>

              <div className="text-xs font-medium text-gray-500">
                {t.markdown.statsSummary(items.length, mergedStats.totalWords, mergedStats.totalLines)}
              </div>
            </div>

            {/* Tab: Files & Ordering */}
            {activeTab === 'files' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  {items.map((item, index) => {
                    const itemStats = countMarkdownStats(item.content);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-3.5 transition-colors hover:border-gray-300"
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs font-bold text-gray-600">
                            {index + 1}
                          </span>
                          <FileCode2 className="h-5 w-5 shrink-0 text-emerald-600" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-gray-900">{item.name}</p>
                            <p className="text-xs text-gray-500">
                              {formatBytes(item.size)} · {itemStats.words.toLocaleString()} palabras ·{' '}
                              {itemStats.lines.toLocaleString()} líneas
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={index === 0 || isProcessing}
                            onClick={() => move(index, -1)}
                            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-30"
                            title={t.markdown.moveUp}
                            aria-label={t.markdown.moveUp}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={index === items.length - 1 || isProcessing}
                            onClick={() => move(index, 1)}
                            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-30"
                            title={t.markdown.moveDown}
                            aria-label={t.markdown.moveDown}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={isProcessing}
                            onClick={() => remove(index)}
                            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                            title={t.markdown.removeFile(item.name)}
                            aria-label={t.markdown.removeFile(item.name)}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-2">
                  <FileDropzone
                    inputId="markdown-add-more"
                    kind={MARKDOWN_FILES}
                    multiple
                    onFilesSelected={addFiles}
                    className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 p-4 text-sm font-semibold text-gray-600 transition-colors hover:border-emerald-500 hover:bg-emerald-50/20 hover:text-emerald-700"
                  >
                    <FilePlus2 className="h-4 w-4 text-emerald-600" />
                    {t.markdown.addMore}
                  </FileDropzone>
                </div>
              </div>
            )}

            {/* Tab: Unified Preview */}
            {activeTab === 'preview' && (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <textarea
                  readOnly
                  value={mergedText}
                  rows={14}
                  className="w-full resize-y rounded-xl border border-gray-200 bg-white p-4 font-mono text-xs leading-relaxed text-gray-800 outline-none focus:border-emerald-400"
                />
              </div>
            )}

            {/* Tab: Settings */}
            {activeTab === 'settings' && (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
                <h3 className="mb-4 text-sm font-bold text-gray-900">{t.markdown.settingsTitle}</h3>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                      {t.markdown.pageSize}
                    </label>
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(e.target.value as PageSizeName)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-xs font-medium text-gray-800 outline-none focus:border-emerald-500"
                    >
                      <option value="A4">{t.markdown.pageSizeA4}</option>
                      <option value="Letter">{t.markdown.pageSizeLetter}</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                      {t.markdown.theme}
                    </label>
                    <select
                      value={theme}
                      onChange={(e) => setTheme(e.target.value as TypographyTheme)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-xs font-medium text-gray-800 outline-none focus:border-emerald-500"
                    >
                      <option value="sans">{t.markdown.themeSans}</option>
                      <option value="serif">{t.markdown.themeSerif}</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                      {t.markdown.pageBreak}
                    </label>
                    <select
                      value={pageBreakPerFile ? 'each' : 'continuous'}
                      onChange={(e) => setPageBreakPerFile(e.target.value === 'each')}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-xs font-medium text-gray-800 outline-none focus:border-emerald-500"
                    >
                      <option value="each">{t.markdown.pageBreakEach}</option>
                      <option value="continuous">{t.markdown.pageBreakContinuous}</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                      {t.markdown.pageNumbers}
                    </label>
                    <select
                      value={showPageNumbers ? 'show' : 'hide'}
                      onChange={(e) => setShowPageNumbers(e.target.value === 'show')}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-xs font-medium text-gray-800 outline-none focus:border-emerald-500"
                    >
                      <option value="show">{t.markdown.showPageNumbers}</option>
                      <option value="hide">{t.markdown.hidePageNumbers}</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                      {t.markdown.separator}
                    </label>
                    <select
                      value={separator}
                      onChange={(e) => setSeparator(e.target.value as MergeSeparatorStyle)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-xs font-medium text-gray-800 outline-none focus:border-emerald-500"
                    >
                      <option value="both">{t.markdown.separatorBoth}</option>
                      <option value="divider">{t.markdown.separatorDivider}</option>
                      <option value="heading">{t.markdown.separatorHeading}</option>
                      <option value="blank">{t.markdown.separatorBlank}</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Processing Panel */}
            {isProcessing && (
              <ProgressPanel
                message={progressMessage}
                percent={progressPercent}
                onCancel={() => abortRef.current?.abort()}
              />
            )}

            {/* Bottom Actions */}
            {!isProcessing && (
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={handleConvertToPdf}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-4 text-base font-bold text-white shadow-sm transition-colors hover:bg-emerald-700"
                >
                  <FileText className="h-5 w-5" />
                  {t.markdown.actionConvertToPdf}
                </button>

                <button
                  type="button"
                  onClick={handleMergeMd}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-6 py-4 text-base font-bold text-gray-800 transition-colors hover:bg-gray-50"
                >
                  <Download className="h-5 w-5 text-gray-500" />
                  {t.markdown.actionMergeMd}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
