'use client';

import { useRef, useState } from 'react';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import Navbar from '@/components/Navbar';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import ProgressPanel from '@/components/ProgressPanel';
import { FileText, Upload, X } from 'lucide-react';
import { describeError, KnownToolError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob } from '@/lib/files';
import { assertFileSize, throwIfCancelled } from '@/lib/limits';
import { openPdf } from '@/lib/pdfjs';
import { extractParagraphs, toTextFragments } from '@/lib/textLayout';

interface ConversionResult {
  blob: Blob;
  paragraphs: number;
  pages: number;
}

export default function PdfToWordPage() {
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
    setProgressMessage('Reading the document…');

    let source: Awaited<ReturnType<typeof openPdf>> | null = null;

    try {
      assertFileSize(file);
      source = await openPdf(await file.arrayBuffer());
      const pageCount = source.document.numPages;

      const paragraphs: Paragraph[] = [];
      let paragraphCount = 0;

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        throwIfCancelled(controller.signal);
        setProgressPercent(4 + (pageNumber / pageCount) * 88);
        setProgressMessage(`Extracting page ${pageNumber} of ${pageCount}…`);

        const page = await source.document.getPage(pageNumber);
        const content = await page.getTextContent();
        page.cleanup();

        for (const text of extractParagraphs(toTextFragments(content.items))) {
          paragraphs.push(new Paragraph({ children: [new TextRun({ text })] }));
          paragraphCount += 1;
        }

        if (pageNumber < pageCount) {
          paragraphs.push(new Paragraph({ children: [] }));
        }
      }

      // A scanned PDF has no text layer at all. Handing back an empty .docx and
      // calling it a success is what sent people away thinking the tool worked.
      if (paragraphCount === 0) {
        throw new KnownToolError(
          'unknown',
          'This PDF has no text to extract',
          'It is most likely a scan — a picture of a page rather than text. Run it through OCR PDF first, then convert the searchable copy.'
        );
      }

      setProgressMessage('Building the Word document…');
      setProgressPercent(96);

      const blob = await Packer.toBlob(
        new Document({
          title: derivedFileName(file.name, ''),
          sections: [{ children: paragraphs }],
        })
      );

      setResult({ blob, paragraphs: paragraphCount, pages: pageCount });
      setProgressPercent(100);
    } catch (caught) {
      const described = describeError(caught);
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
          <h1 className="mb-4 text-4xl font-bold text-gray-900">PDF to Word</h1>
          <p className="mx-auto max-w-xl text-gray-600">
            Pull the text out of a PDF into an editable .docx. Text only — images, tables and
            layout are not carried over.
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
                    <p className="text-lg font-semibold">Choose a PDF file</p>
                    <p className="text-sm text-gray-500">or drop one here</p>
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
                    aria-label="Remove this file"
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
                    {isProcessing ? 'Converting…' : 'Convert to Word'}
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
            <h2 className="mb-2 text-2xl font-bold">Your Word document is ready</h2>
            <p className="mb-8 text-gray-600">
              {result.paragraphs.toLocaleString()}{' '}
              {result.paragraphs === 1 ? 'paragraph' : 'paragraphs'} from {result.pages}{' '}
              {result.pages === 1 ? 'page' : 'pages'}.
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <button
                type="button"
                onClick={() =>
                  file && downloadBlob(result.blob, derivedFileName(file.name, '.docx'))
                }
                className="rounded-full bg-blue-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-blue-200 hover:bg-blue-700"
              >
                Download .docx
              </button>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setFile(null);
                }}
                className="rounded-full bg-gray-100 px-8 py-4 text-lg font-bold text-gray-700 hover:bg-gray-200"
              >
                Convert another
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
