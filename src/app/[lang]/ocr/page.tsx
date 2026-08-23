'use client';

import { useRef, useState } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { savePdf } from '@/lib/pdfio';
import { createWorker } from 'tesseract.js';
import Navbar from '@/components/Navbar';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import ProgressPanel from '@/components/ProgressPanel';
import { CheckCircle2, Download, FileText, Languages, ScanText, Type } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { describeError, KnownToolError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob } from '@/lib/files';
import { assertFileSize, assertPageCount, MAX_OCR_PAGES, throwIfCancelled } from '@/lib/limits';
import { openPdf, renderPageToJpeg } from '@/lib/pdfjs';
import { OCR_SCALE, TESSERACT_PATHS } from '@/lib/ocrRuntime';
import { extractOcrWords, fitFontSize, RECOGNIZE_OUTPUT, toWinAnsi } from '@/lib/ocr';

type OcrLanguage = 'spa' | 'eng' | 'fra' | 'deu' | 'ita' | 'por';

const LANGUAGES: OcrLanguage[] = ['spa', 'eng', 'fra', 'deu', 'ita', 'por'];

interface OcrResult {
  pdf: Blob;
  text: string;
  pages: number;
  wordsFound: number;
}

export default function OcrPage() {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<OcrLanguage>('spa');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState<ToolError | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setProgressPercent(0);
    setProgressMessage('');
  };

  const selectFile = (selected: File) => {
    setFile(selected);
    setResult(null);
    setError(null);
  };

  const runOcr = async () => {
    if (!file) return;

    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    setIsProcessing(true);
    setError(null);
    setProgressPercent(2);
    setProgressMessage(t.ocr.starting);

    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    let pdfSource: Awaited<ReturnType<typeof openPdf>> | null = null;

    try {
      assertFileSize(file, t);

      worker = await createWorker(language, 1, TESSERACT_PATHS);
      throwIfCancelled(signal, t);

      setProgressPercent(8);
      setProgressMessage(t.ocr.reading);

      pdfSource = await openPdf(await file.arrayBuffer());
      const pageCount = pdfSource.document.numPages;
      assertPageCount(pageCount, MAX_OCR_PAGES, 'ocr', t);

      const output = await PDFDocument.create();
      const font = await output.embedFont(StandardFonts.Helvetica);
      const measure = (text: string, size: number) => font.widthOfTextAtSize(text, size);

      let fullText = '';
      let wordsFound = 0;

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        throwIfCancelled(signal, t);
        setProgressPercent(8 + ((pageNumber - 1) / pageCount) * 86);
        setProgressMessage(t.ocr.readingPage(pageNumber, pageCount));

        const page = await pdfSource.document.getPage(pageNumber);

        // JPEG rather than PNG: a page of scanned text as lossless PNG is roughly
        // ten times the size, which is how the "searchable" copy used to come back
        // an order of magnitude heavier than the original.
        const { blob, width, height } = await renderPageToJpeg(page, OCR_SCALE, 0.82);
        page.cleanup();

        const imageBytes = new Uint8Array(await blob.arrayBuffer());
        const { data } = await worker.recognize(blob, {}, RECOGNIZE_OUTPUT);
        throwIfCancelled(signal, t);

        fullText += `--- Page ${pageNumber} ---\n${data.text.trim()}\n\n`;

        const image = await output.embedJpg(imageBytes);
        const pageWidth = width / OCR_SCALE;
        const pageHeight = height / OCR_SCALE;
        const newPage = output.addPage([pageWidth, pageHeight]);
        newPage.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });

        // The invisible text layer. This is what makes the output searchable, and
        // it is what silently never ran before: tesseract.js only returns `blocks`
        // when asked, so the old `data.words` was always undefined.
        for (const word of extractOcrWords(data)) {
          const text = toWinAnsi(word.text);
          if (text === '') continue;

          // Measured on the text that will actually be drawn. Measuring the
          // ORIGINAL meant one word mixing Spanish with a character the font
          // cannot encode — «precio→10», «ﬁnal», «Łukasz» — threw here and
          // killed the whole run, minutes in, with nothing to show. The guard
          // above only catches words that are entirely unencodable. Studio was
          // fixed for this and the tool never was.
          const size = fitFontSize({ ...word, text }, OCR_SCALE, measure);
          newPage.drawText(text, {
            x: word.left / OCR_SCALE,
            // PDF coordinates start at the bottom; tesseract measures from the top.
            y: pageHeight - word.bottom / OCR_SCALE,
            size,
            font,
            color: rgb(0, 0, 0),
            opacity: 0,
          });
          wordsFound += 1;
        }
      }

      setProgressMessage(t.ocr.assembling);
      setProgressPercent(96);

      const bytes = (await savePdf(output)).slice();

      if (wordsFound === 0) {
        throw new KnownToolError(
          'unknown',
          t.ocr.noTextTitle,
          t.ocr.noTextBody
        );
      }

      setResult({
        pdf: new Blob([bytes], { type: 'application/pdf' }),
        text: fullText.trim(),
        pages: pageCount,
        wordsFound,
      });
      setProgressPercent(100);
    } catch (caught) {
      const described = describeError(caught, t);
      if (described.kind !== 'cancelled') setError(described);
    } finally {
      abortRef.current = null;
      await worker?.terminate().catch(() => {});
      await pdfSource?.destroy().catch(() => {});
      setIsProcessing(false);
    }
  };

  const copyText = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError({
        kind: 'unknown',
        title: t.ocr.copyFailedTitle,
        detail: t.ocr.copyFailedBody,
      });
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Navbar />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 text-orange-600 shadow-sm">
            <ScanText className="h-8 w-8" />
          </div>
          <h1 className="mb-3 text-4xl font-semibold tracking-tight text-gray-900">{t.ocr.heading}</h1>
          <p className="mx-auto max-w-xl text-gray-500">
            {t.ocr.intro}
          </p>
        </div>

        <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
          {!result ? (
            <div className="p-8 sm:p-12">
              <div className="mx-auto max-w-xl space-y-8">
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    {t.ocr.step1}
                  </label>
                  <FileDropzone
                    inputId="ocr-file-input"
                    kind={PDF_FILES}
                    disabled={isProcessing}
                    onFilesSelected={([selected]) => selectFile(selected)}
                    className={cn(
                      'flex h-32 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all',
                      file
                        ? 'border-orange-500 bg-orange-50/50'
                        : 'border-gray-300 bg-gray-50 hover:border-orange-400 hover:bg-gray-100'
                    )}
                  >
                    <FileText
                      className={cn('mb-3 h-8 w-8', file ? 'text-orange-600' : 'text-gray-400')}
                    />
                    <p className="px-4 text-center text-sm font-medium text-gray-700">
                      {file ? file.name : `${t.common.choosePdf} — ${t.common.orDropIt}`}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {file ? t.ocr.chooseAnother : t.ocr.upTo(MAX_OCR_PAGES)}
                    </p>
                  </FileDropzone>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    {t.ocr.step2}
                  </label>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {LANGUAGES.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setLanguage(option)}
                        disabled={isProcessing}
                        aria-pressed={language === option}
                        className={cn(
                          'flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                          language === option
                            ? 'border-orange-500 bg-orange-50 text-orange-700'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-orange-200 hover:bg-gray-50'
                        )}
                      >
                        <Languages className="h-4 w-4" />
                        {t.ocr.languages[option]}
                      </button>
                    ))}
                  </div>
                </div>

                <ErrorNotice error={error} onDismiss={() => setError(null)} />

                <div className="space-y-6 pt-2">
                  <button
                    type="button"
                    onClick={runOcr}
                    disabled={!file || isProcessing}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-600 px-6 py-4 text-lg font-medium text-white shadow-sm transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ScanText className="h-5 w-5" />
                    {isProcessing ? t.ocr.working : t.ocr.action}
                  </button>

                  {isProcessing && (
                    <ProgressPanel
                      accent="orange"
                      message={progressMessage}
                      percent={progressPercent}
                      onCancel={() => abortRef.current?.abort()}
                    />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 sm:p-12">
              <div className="mx-auto max-w-2xl">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <h2 className="mb-2 text-center text-2xl font-semibold text-gray-900">
                  {t.ocr.doneTitle(result.wordsFound)}
                </h2>
                <p className="mb-10 text-center text-gray-500">
                  {t.ocr.doneBody(result.pages)}
                </p>

                <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() =>
                      file && downloadBlob(result.pdf, derivedFileName(file.name, '_searchable.pdf'))
                    }
                    className="group flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-orange-200 bg-orange-50 p-6 transition-colors hover:bg-orange-100"
                  >
                    <div className="rounded-xl bg-white p-3 text-orange-600 shadow-sm transition-transform group-hover:scale-110">
                      <Download className="h-6 w-6" />
                    </div>
                    <div className="text-center">
                      <span className="mb-1 block font-semibold text-orange-900">
                        {t.ocr.searchablePdf}
                      </span>
                      <span className="text-xs text-orange-700 opacity-80">
                        {t.ocr.searchablePdfNote}
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      file &&
                      downloadBlob(
                        new Blob([result.text], { type: 'text/plain;charset=utf-8' }),
                        derivedFileName(file.name, '_extracted.txt')
                      )
                    }
                    className="group flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-blue-200 bg-blue-50 p-6 transition-colors hover:bg-blue-100"
                  >
                    <div className="rounded-xl bg-white p-3 text-blue-600 shadow-sm transition-transform group-hover:scale-110">
                      <Type className="h-6 w-6" />
                    </div>
                    <div className="text-center">
                      <span className="mb-1 block font-semibold text-blue-900">{t.ocr.plainText}</span>
                      <span className="text-xs text-blue-700 opacity-80">{t.ocr.plainTextNote}</span>
                    </div>
                  </button>
                </div>

                <ErrorNotice error={error} onDismiss={() => setError(null)} />

                <div className="mb-8 mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 font-medium text-gray-900">
                      <FileText className="h-4 w-4 text-gray-500" />
                      {t.ocr.recognisedText}
                    </h3>
                    <button
                      type="button"
                      onClick={copyText}
                      className="text-sm font-medium text-orange-600 transition-colors hover:text-orange-700"
                    >
                      {copied ? t.ocr.copied : t.ocr.copy}
                    </button>
                  </div>
                  <div className="h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4">
                    <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700">
                      {result.text}
                    </pre>
                  </div>
                </div>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={reset}
                    className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
                  >
                    {t.ocr.another}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
