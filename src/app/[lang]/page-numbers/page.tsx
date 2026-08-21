'use client';

import { useMemo, useState } from 'react';
import type { PDFDocument } from 'pdf-lib';
import Navbar from '@/components/Navbar';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import StampPreview from '@/components/StampPreview';
import {
  AnchorPicker,
  ColorRow,
  Field,
  FontPicker,
  NumberRow,
  PageScopePicker,
  Pills,
  type PageScope,
} from '@/components/StampControls';
import { Download, FileText, Loader2, Upload, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { describeError, KnownToolError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob } from '@/lib/files';
import type { Anchor } from '@/lib/geometry';
import { assertFileSize } from '@/lib/limits';
import { parsePageSet, summarizePages } from '@/lib/pageRange';
import { loadPdf, savePdf } from '@/lib/pdfio';
import { openPdf } from '@/lib/pdfjs';
import {
  hexToRgb,
  stampPageNumbers,
  UnsupportedCharacterError,
  type FontChoice,
  type NumberStamp,
} from '@/lib/stamp';

export default function PageNumbersPage() {
  const { t } = useI18n();

  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [format, setFormat] = useState<NumberStamp['format']>('plain');
  const [startAt, setStartAt] = useState(1);
  const [font, setFont] = useState<FontChoice>({ family: 'helvetica', bold: false, italic: false });
  const [size, setSize] = useState(11);
  const [color, setColor] = useState('#333333');
  const [anchor, setAnchor] = useState<Anchor>('bottom-center');
  const [margin, setMargin] = useState(36);
  const [scope, setScope] = useState<PageScope>({ mode: 'all', range: '' });

  const [isWorking, setIsWorking] = useState(false);
  const [result, setResult] = useState<{ blob: Blob; pages: number } | null>(null);
  const [error, setError] = useState<ToolError | null>(null);

  // In state rather than a ref: the preview reads it while rendering.
  const [bytes, setBytes] = useState<Uint8Array | null>(null);

  const selection = useMemo(() => {
    if (pageCount === 0) return { pages: [] as number[], invalid: [] as string[] };
    if (scope.mode === 'all') {
      return {
        pages: Array.from({ length: pageCount }, (_, index) => index + 1),
        invalid: [] as string[],
      };
    }
    return parsePageSet(scope.range, pageCount);
  }, [scope, pageCount]);

  const stamp = (): NumberStamp => ({
    font,
    size,
    color: hexToRgb(color),
    anchor,
    margin,
    startAt,
    format,
    ofWord: t.pageNumbers.ofWord,
  });

  const reset = () => {
    setBytes(null);
    setFile(null);
    setPageCount(0);
    setResult(null);
    setError(null);
    setScope({ mode: 'all', range: '' });
  };

  const selectFile = async (selected: File) => {
    reset();
    try {
      assertFileSize(selected, t);
      const loaded = new Uint8Array(await selected.arrayBuffer());
      const opened = await openPdf(loaded);
      const count = opened.document.numPages;
      await opened.destroy().catch(() => {});

      setBytes(loaded);
      setFile(selected);
      setPageCount(count);
    } catch (caught) {
      setError(describeError(caught, t));
    }
  };

  const apply = async () => {
    if (!bytes) return;

    if (selection.pages.length === 0) {
      setError({ kind: 'invalid', title: t.stamp.whichPages, detail: t.stamp.rangeEmpty });
      return;
    }

    setIsWorking(true);
    setError(null);

    try {
      const document = await loadPdf(bytes, { updateMetadata: false });
      await stampPageNumbers(document, selection.pages, stamp());
      const saved = (await savePdf(document)).slice();

      setResult({
        blob: new Blob([saved as unknown as BlobPart], { type: 'application/pdf' }),
        pages: selection.pages.length,
      });
    } catch (caught) {
      setError(
        caught instanceof UnsupportedCharacterError
          ? describeError(
              new KnownToolError(
                'invalid',
                t.pageNumbers.format,
                t.stamp.unsupportedCharacter(caught.character)
              ),
              t
            )
          : describeError(caught, t)
      );
    } finally {
      setIsWorking(false);
    }
  };

  const previewPage = selection.pages[0] ?? 1;
  const signature = JSON.stringify([format, startAt, font, size, color, anchor, margin, previewPage]);

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-12 text-center">
          <h1 className="mb-4 text-4xl font-bold text-gray-900">{t.pageNumbers.heading}</h1>
          <p className="text-gray-600">{t.pageNumbers.intro}</p>
        </div>

        {!file ? (
          <div className="space-y-6">
            <FileDropzone
              inputId="page-numbers-file-input"
              kind={PDF_FILES}
              onFilesSelected={([selected]) => void selectFile(selected)}
              className="cursor-pointer rounded-3xl border-2 border-dashed border-gray-300 bg-white p-12 text-center transition-all hover:border-cyan-400"
            >
              <div className="flex flex-col items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-cyan-50 text-cyan-600">
                  <Upload className="h-8 w-8" />
                </div>
                <div>
                  <p className="text-lg font-semibold">{t.pageNumbers.choose}</p>
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
            <h2 className="mb-2 text-2xl font-bold">{t.pageNumbers.doneTitle(result.pages)}</h2>
            <p className="mb-8 text-gray-600">{t.pageNumbers.doneBody}</p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <button
                type="button"
                onClick={() =>
                  downloadBlob(result.blob, derivedFileName(file.name, '_numbered.pdf'))
                }
                className="flex items-center gap-2 rounded-full bg-cyan-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-cyan-200 transition-all hover:bg-cyan-700"
              >
                <Download className="h-5 w-5" />
                {t.common.download}
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-full bg-gray-100 px-8 py-4 text-lg font-bold text-gray-700 transition-all hover:bg-gray-200"
              >
                {t.pageNumbers.another}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between rounded-2xl border bg-white p-4">
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-6 w-6 shrink-0 text-cyan-600" />
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

            <ErrorNotice error={error} onDismiss={() => setError(null)} />

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <div className="space-y-6 rounded-3xl border bg-white p-6 shadow-sm">
                <Field label={t.pageNumbers.format}>
                  <Pills
                    label={t.pageNumbers.format}
                    value={format}
                    options={[
                      { value: 'plain' as const, label: t.pageNumbers.formatPlain },
                      { value: 'ofTotal' as const, label: t.pageNumbers.formatOfTotal },
                    ]}
                    onChange={setFormat}
                  />
                </Field>

                <NumberRow
                  label={t.pageNumbers.startAt}
                  hint={t.pageNumbers.startAtNote}
                  value={startAt}
                  min={0}
                  max={99999}
                  onChange={setStartAt}
                />

                <Field label={t.stamp.typeface}>
                  <FontPicker value={font} onChange={setFont} />
                </Field>

                <div className="flex flex-wrap gap-8">
                  <NumberRow label={t.stamp.size} value={size} min={4} max={96} onChange={setSize} />
                  <ColorRow label={t.stamp.color} value={color} onChange={setColor} />
                </div>

                <div className="flex flex-wrap items-start gap-8">
                  <Field label={t.stamp.position}>
                    <AnchorPicker value={anchor} onChange={setAnchor} />
                  </Field>
                  <NumberRow
                    label={t.stamp.margin}
                    hint={t.stamp.marginNote}
                    value={margin}
                    min={0}
                    max={200}
                    onChange={setMargin}
                  />
                </div>

                <PageScopePicker
                  scope={scope}
                  onChange={setScope}
                  pages={selection.pages}
                  invalid={selection.invalid}
                  summary={summarizePages(selection.pages)}
                />
              </div>

              <div className="space-y-4">
                <StampPreview
                  bytes={bytes}
                  pageNumber={previewPage}
                  signature={signature}
                  apply={async (document: PDFDocument) => {
                    // The extracted document holds one page, but the label must
                    // read as it will in the finished file, so the preview is
                    // told how many pages the run really covers.
                    await stampPageNumbers(document, [1], stamp(), {
                      stampedCount: selection.pages.length,
                    });
                  }}
                />

                <button
                  type="button"
                  onClick={apply}
                  disabled={isWorking || selection.pages.length === 0}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-cyan-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-cyan-200 transition-all hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
                >
                  {isWorking ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" /> {t.pageNumbers.working}
                    </>
                  ) : (
                    t.pageNumbers.action
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
