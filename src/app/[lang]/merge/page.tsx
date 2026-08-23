'use client';

import { useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { loadPdf, savePdf } from '@/lib/pdfio';
import {
  STRUCTURE_CATEGORIES,
  diffStructures,
  summarizeStructures,
  type StructuralSummary,
  type StructureCategory,
} from '@/lib/verify/structural';
import Navbar from '@/components/Navbar';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import ProgressPanel from '@/components/ProgressPanel';
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileText,
  Info,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { describeError, type ToolError } from '@/lib/errors';
import { downloadBlob, formatBytes } from '@/lib/files';
import { assertFileSize, throwIfCancelled, yieldToBrowser } from '@/lib/limits';

interface Entry {
  id: number;
  file: File;
}

export default function MergePage() {
  const { locale, t } = useI18n();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [result, setResult] = useState<{ blob: Blob; pages: number } | null>(null);
  const [lostCategories, setLostCategories] = useState<StructureCategory[]>([]);
  /** True when any of the merged files arrived with a digital signature. */
  const [anyInputSigned, setAnyInputSigned] = useState(false);
  const [error, setError] = useState<ToolError | null>(null);
  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);

  const addFiles = (files: File[]) => {
    setError(null);
    setEntries((previous) => [
      ...previous,
      ...files.map((file) => ({ id: nextId.current++, file })),
    ]);
  };

  const move = (index: number, direction: -1 | 1) => {
    setEntries((previous) => {
      const target = index + direction;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const merge = async () => {
    if (entries.length < 2) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setIsProcessing(true);
    setError(null);
    setProgressPercent(4);

    try {
      const merged = await PDFDocument.create();
      const inputSummaries: StructuralSummary[] = [];

      for (const [index, entry] of entries.entries()) {
        throwIfCancelled(controller.signal, t);
        setProgressPercent(4 + (index / entries.length) * 88);
        setProgressMessage(t.merge.adding(entry.file.name));

        assertFileSize(entry.file, t);
        const source = await loadPdf(new Uint8Array(await entry.file.arrayBuffer()), {
          updateMetadata: false,
        });

        // Merging genuinely assembles a new document, so everything that lives
        // outside the page tree — forms, bookmarks, attachments — cannot come
        // along. Record what each input carried so the result card can say
        // exactly what was given up, instead of a vague forms-only warning.
        inputSummaries.push(summarizeStructures(source));

        const copied = await merged.copyPages(source, source.getPageIndices());
        for (const page of copied) merged.addPage(page);
        // Same reason as in split: give the browser a frame between files.
        await yieldToBrowser();
      }

      setProgressMessage(t.merge.saving);
      setProgressPercent(96);

      const bytes = (await savePdf(merged)).slice();

      // Aggregate what the inputs had, compare against what the output has —
      // read from the document object that produced the bytes.
      const aggregate: StructuralSummary = {
        pageCount: inputSummaries.reduce((sum, item) => sum + item.pageCount, 0),
        categories: Object.fromEntries(
          STRUCTURE_CATEGORIES.map((category) => [
            category,
            inputSummaries.reduce((sum, item) => sum + item.categories[category], 0),
          ])
        ) as StructuralSummary['categories'],
      };
      setLostCategories(
        diffStructures(aggregate, summarizeStructures(merged)).map((loss) => loss.category)
      );
      // One signed input is enough: the merged file is a new file, so whatever
      // signature came in no longer describes it. It is not in `lostCategories`
      // because nothing went missing — the dictionary is copied along with the
      // pages — which is exactly what makes saying it out loud necessary.
      setAnyInputSigned(inputSummaries.some((item) => item.categories.signatures > 0));
      setResult({
        blob: new Blob([bytes], { type: 'application/pdf' }),
        pages: merged.getPageCount(),
      });
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
          <h1 className="mb-4 text-4xl font-bold text-gray-900">{t.merge.heading}</h1>
          <p className="text-gray-600">{t.merge.intro}</p>
        </div>

        {!result ? (
          <div className="space-y-8">
            <FileDropzone
              inputId="merge-file-input"
              kind={PDF_FILES}
              multiple
              disabled={isProcessing}
              onFilesSelected={addFiles}
              className={cn(
                'cursor-pointer rounded-3xl border-2 border-dashed bg-white p-12 text-center transition-all',
                entries.length > 0 ? 'border-blue-200' : 'border-gray-300 hover:border-blue-400'
              )}
            >
              <div className="flex flex-col items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <Upload className="h-8 w-8" />
                </div>
                <div>
                  <p className="text-lg font-semibold">{t.merge.choose}</p>
                  <p className="text-sm text-gray-500">{t.common.orDropThem}</p>
                </div>
              </div>
            </FileDropzone>

            <ErrorNotice error={error} onDismiss={() => setError(null)} />

            {entries.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-medium text-gray-700">
                    {t.merge.listHeading(entries.length)}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setEntries([])}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    {t.merge.removeAll}
                  </button>
                </div>

                <ol className="space-y-2">
                  {entries.map((entry, index) => (
                    <li
                      key={entry.id}
                      className="flex items-center gap-3 rounded-xl border bg-white p-3"
                    >
                      <span className="w-6 shrink-0 text-center text-sm tabular-nums text-gray-400">
                        {index + 1}
                      </span>
                      <FileText className="h-5 w-5 shrink-0 text-gray-400" />
                      <span className="min-w-0 flex-1 truncate text-sm">{entry.file.name}</span>
                      <span className="hidden shrink-0 text-xs tabular-nums text-gray-400 sm:inline">
                        {formatBytes(entry.file.size)}
                      </span>
                      <div className="flex shrink-0 items-center">
                        <button
                          type="button"
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                          aria-label={t.merge.moveEarlier(entry.file.name)}
                          className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-blue-600 disabled:opacity-30"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(index, 1)}
                          disabled={index === entries.length - 1}
                          aria-label={t.merge.moveLater(entry.file.name)}
                          className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-blue-600 disabled:opacity-30"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEntries((previous) =>
                              previous.filter((item) => item.id !== entry.id)
                            )
                          }
                          aria-label={t.merge.remove(entry.file.name)}
                          className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-500"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>

                {isProcessing && (
                  <ProgressPanel
                    message={progressMessage}
                    percent={progressPercent}
                    onCancel={() => abortRef.current?.abort()}
                  />
                )}

                <div className="flex justify-center pt-4">
                  <button
                    type="button"
                    onClick={merge}
                    disabled={entries.length < 2 || isProcessing}
                    className="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" /> {t.merge.working}
                      </>
                    ) : (
                      t.merge.action
                    )}
                  </button>
                </div>
                {entries.length < 2 && (
                  <p className="text-center text-sm text-gray-500">{t.merge.needTwo}</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-3xl border bg-white p-12 text-center shadow-sm">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-600">
              <FileText className="h-10 w-10" />
            </div>
            <h2 className="mb-2 text-2xl font-bold">
              {t.merge.doneTitle(result.pages)}
            </h2>
            <p className="mb-6 text-gray-600">{formatBytes(result.blob.size)}</p>

            {anyInputSigned && (
              <p className="mx-auto mb-4 max-w-lg rounded-2xl border border-red-200 bg-red-50 p-4 text-left text-sm text-red-900">
                {t.common.signatureBroken}
              </p>
            )}

            {lostCategories.length > 0 && (
              <div className="mx-auto mb-8 flex max-w-lg items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <p className="text-sm text-amber-900">
                  {t.merge.lostNote(
                    new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
                      lostCategories.map((category) => t.structures[category])
                    )
                  )}
                </p>
              </div>
            )}

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <button
                type="button"
                onClick={() => downloadBlob(result.blob, 'merged.pdf')}
                className="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700"
              >
                <Download className="h-5 w-5" />
                {t.common.download}
              </button>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setLostCategories([]);
                }}
                className="rounded-full bg-gray-100 px-8 py-4 text-lg font-bold text-gray-700 transition-all hover:bg-gray-200"
              >
                {t.merge.another}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
