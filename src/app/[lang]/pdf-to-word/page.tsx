'use client';

import { useRef, useState } from 'react';
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import Navbar from '@/components/Navbar';
import ResultHeading from '@/components/ResultHeading';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import ProgressPanel from '@/components/ProgressPanel';
import { FileText, Upload, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { describeError, KnownToolError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob } from '@/lib/files';
import { assertFileSize, throwIfCancelled } from '@/lib/limits';
import { openPdf } from '@/lib/pdfjs';
import { extractDocumentElements, toTextFragments } from '@/lib/textLayout';

interface ConversionResult {
  blob: Blob;
  paragraphs: number;
  headings: number;
  tables: number;
  pages: number;
  pagesWithText: number;
}

export default function PdfToWordPage() {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<ToolError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const convert = async () => {
    if (!file) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setIsProcessing(true);
    setError(null);
    setProgressPercent(4);
    setProgressMessage(t.pdfToWord.reading);

    let source: Awaited<ReturnType<typeof openPdf>> | null = null;

    try {
      assertFileSize(file, t);
      source = await openPdf(await file.arrayBuffer());
      const pageCount = source.document.numPages;

      const docChildren: (Paragraph | Table)[] = [];
      let paragraphCount = 0;
      let headingCount = 0;
      let tableCount = 0;
      let pagesWithText = 0;

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        throwIfCancelled(controller.signal, t);
        setProgressPercent(4 + (pageNumber / pageCount) * 88);
        setProgressMessage(t.pdfToWord.extractingPage(pageNumber, pageCount));

        const page = await source.document.getPage(pageNumber);
        const content = await page.getTextContent();
        page.cleanup();

        let onThisPage = 0;
        const elements = extractDocumentElements(toTextFragments(content.items));

        for (const el of elements) {
          if (el.type === 'heading') {
            docChildren.push(
              new Paragraph({
                heading: el.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
                children: el.runs.map(
                  (r) => new TextRun({ text: r.text, bold: r.bold ?? true, italics: r.italic })
                ),
                spacing: { before: 240, after: 120 },
              })
            );
            headingCount += 1;
            onThisPage += 1;
          } else if (el.type === 'table') {
            docChildren.push(
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: el.rows.map((rowCells) =>
                  new TableRow({
                    children: rowCells.map(
                      (cellText) =>
                        new TableCell({
                          children: [
                            new Paragraph({
                              children: [new TextRun({ text: cellText, size: 20 })],
                            }),
                          ],
                          margins: { top: 80, bottom: 80, left: 120, right: 120 },
                        })
                    ),
                  })
                ),
              })
            );
            tableCount += 1;
            onThisPage += 1;
          } else {
            docChildren.push(
              new Paragraph({
                children: el.runs.map(
                  (r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic })
                ),
                spacing: { after: 120 },
              })
            );
            paragraphCount += 1;
            onThisPage += 1;
          }
        }

        if (onThisPage > 0) pagesWithText += 1;

        if (pageNumber < pageCount) {
          docChildren.push(new Paragraph({ children: [] }));
        }
      }

      // A scanned PDF has no text layer at all.
      const totalElements = paragraphCount + headingCount + tableCount;
      if (totalElements === 0) {
        throw new KnownToolError(
          'unknown',
          t.pdfToWord.noTextTitle,
          t.pdfToWord.noTextBody
        );
      }

      setProgressMessage(t.pdfToWord.building);
      setProgressPercent(96);

      const blob = await Packer.toBlob(
        new Document({
          title: derivedFileName(file.name, ''),
          sections: [{ children: docChildren }],
        })
      );

      setResult({
        blob,
        paragraphs: paragraphCount,
        headings: headingCount,
        tables: tableCount,
        pages: pageCount,
        pagesWithText,
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

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-12 text-center">
          <h1 className="mb-4 text-4xl font-bold text-gray-900">{t.pdfToWord.heading}</h1>
          <p className="mx-auto max-w-xl text-gray-600">
            {t.pdfToWord.intro}
          </p>
        </div>

        {!result ? (
          <div className="space-y-8">
            {!file ? (
              <>
                <FileDropzone
                  inputId="pdf-to-word-file-input"
                  kind={PDF_FILES}
                  onFilesSelected={([selected]) => {
                    setFile(selected);
                    setError(null);
                  }}
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
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      setError(null);
                    }}
                    aria-label={t.common.removeFile}
                    className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-red-500"
                  >
                    <X className="h-5 w-5" />
                  </button>
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
                    onClick={convert}
                    disabled={isProcessing}
                    className="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {isProcessing ? t.pdfToWord.working : t.pdfToWord.action}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-3xl border bg-white p-12 text-center shadow-sm">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-600">
              <FileText className="h-10 w-10" />
            </div>
            <ResultHeading className="mb-2 text-2xl font-bold">{t.pdfToWord.doneTitle}</ResultHeading>
            <p className="mb-2 text-gray-600">
              {t.pdfToWord.doneBody(result.paragraphs, result.pagesWithText)}
            </p>
            {(result.headings > 0 || result.tables > 0) && (
              <p className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                {result.headings > 0 && `${result.headings} ${result.headings === 1 ? 'encabezado estructurado' : 'encabezados estructurados'}`}
                {result.headings > 0 && result.tables > 0 && ' · '}
                {result.tables > 0 && `${result.tables} ${result.tables === 1 ? 'tabla detectada' : 'tablas detectadas'}`}
              </p>
            )}
            {result.pages - result.pagesWithText > 0 ? (
              /* The pages that gave nothing, named. The file is still handed
                 over — it is what it is — but not under a sentence that
                 implies it holds the whole document. */
              <div className="mx-auto mb-8 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">
                {t.pdfToWord.emptyPagesNote(result.pages - result.pagesWithText, result.pages)}
              </div>
            ) : (
              <div className="mb-4" />
            )}
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <button
                type="button"
                onClick={() =>
                  file && downloadBlob(result.blob, derivedFileName(file.name, '.docx'))
                }
                className="rounded-full bg-blue-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-blue-200 hover:bg-blue-700"
              >
                {t.pdfToWord.downloadDocx}
              </button>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setFile(null);
                }}
                className="rounded-full bg-gray-100 px-8 py-4 text-lg font-bold text-gray-700 hover:bg-gray-200"
              >
                {t.pdfToWord.another}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
