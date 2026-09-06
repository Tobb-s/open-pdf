'use client';

import { useEffect, useRef, useState } from 'react';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { savePdf } from '@/lib/pdfio';
import OcrControls from '@/components/OcrControls';
import OcrReview from '@/components/OcrReview';
import { DEFAULT_OCR_OPTIONS, layerWords, type OcrPageResult } from '@/lib/ocrAdvanced';
import type { OcrWord } from '@/lib/ocr';
import { createOcrEngine } from '@/lib/ocrEngine';
import Navbar from '@/components/Navbar';
import ResultHeading from '@/components/ResultHeading';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import ProgressPanel from '@/components/ProgressPanel';
import { CheckCircle2, Download, FileText, Info, ScanText, Type, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { describeError, KnownToolError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob } from '@/lib/files';
import { assertFileSize, assertPageCount, MAX_OCR_PAGES, throwIfCancelled } from '@/lib/limits';
import { openPdf } from '@/lib/pdfjs';
import { reportStructures, type StructureCategory } from '@/lib/verify/structural';
import {
  confidenceSummary,
  losesCharacters,
} from '@/lib/ocr';

interface OcrResult {
  pdf: Blob;
  recognized: OcrPageResult[];
  text: string;
  pages: number;
  wordsFound: number;
  /** Mean tesseract confidence over the words in the layer, 0–100. */
  meanConfidence: number;
  /** Words under LOW_CONFIDENCE: the engine itself was not sure. */
  lowConfidence: number;
  /** Words whose search-layer copy lost characters the PDF font cannot carry. */
  stripped: number;
  /** Structural losses reported by the post-export check, if any. */
  lost: StructureCategory[];
}

/** Pages sampled for an existing text layer when a file is chosen. */
const TEXT_SAMPLE_PAGES = 3;

export default function OcrPage() {
  const { locale, t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState(DEFAULT_OCR_OPTIONS);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState<ToolError | null>(null);
  const [copied, setCopied] = useState(false);
  /** True when the chosen file already carries real text on its first pages. */
  const [hasRealText, setHasRealText] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const selectionRef = useRef(0);
  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = () => {
    selectionRef.current++;
    abortRef.current?.abort();
    setFile(null);
    setResult(null);
    setError(null);
    setHasRealText(false);
    setProgressPercent(0);
    setProgressMessage('');
  };

  /** Sample only for advice; recognition checks every page independently. */
  const selectFile = async (selected: File) => {
    const selection = ++selectionRef.current;
    setFile(selected);
    setResult(null);
    setError(null);
    setHasRealText(false);

    let source: Awaited<ReturnType<typeof openPdf>> | null = null;
    try {
      source = await openPdf(await selected.arrayBuffer());
      const sampled = Math.min(TEXT_SAMPLE_PAGES, source.document.numPages);
      let characters = 0;
      for (let pageNumber = 1; pageNumber <= sampled; pageNumber += 1) {
        const page = await source.document.getPage(pageNumber);
        const content = await page.getTextContent();
        characters += content.items.reduce(
          (total, item) => total + ('str' in item ? item.str.trim().length : 0),
          0
        );
        page.cleanup();
      }
      if (selection === selectionRef.current) setHasRealText(characters > 200 * sampled);
    } catch {
      // Advice, not a gate: a file this cannot open is reported properly by
      // the run itself, with the message that case deserves.
    } finally {
      await source?.destroy().catch(() => {});
    }
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

    let engine: Awaited<ReturnType<typeof createOcrEngine>> | null = null;
    let pdfSource: Awaited<ReturnType<typeof openPdf>> | null = null;

    try {
      assertFileSize(file, t);

      engine = await createOcrEngine(options, signal);
      throwIfCancelled(signal, t);

      setProgressPercent(8);
      setProgressMessage(t.ocr.reading);

      pdfSource = await openPdf(await file.arrayBuffer());
      const pageCount = pdfSource.document.numPages;
      assertPageCount(pageCount, MAX_OCR_PAGES, 'ocr', t);

      const output = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
      const font = await output.embedFont(StandardFonts.Helvetica);
      const measure = (text: string, size: number) => font.widthOfTextAtSize(text, size);

      let fullText = '';
      let wordsFound = 0;
      const confidences: number[] = [];
      let stripped = 0;
      const recognized: OcrPageResult[] = [];

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        throwIfCancelled(signal, t);
        setProgressPercent(8 + ((pageNumber - 1) / pageCount) * 86);
        setProgressMessage(t.ocr.readingPage(pageNumber, pageCount));

        const page = await pdfSource.document.getPage(pageNumber);

        const recognizedPage = await engine.page(page, detail => setProgressMessage(`${t.ocr.readingPage(pageNumber, pageCount)} · ${detail}`));
        throwIfCancelled(signal, t);
        recognized.push(recognizedPage);
        fullText += `--- Page ${pageNumber} ---\n${recognizedPage.text}\n\n`;
        confidences.push(...recognizedPage.words.map(word => word.confidence));
        stripped += recognizedPage.words.filter(word => losesCharacters(word.text)).length;
        for (const word of layerWords(recognizedPage, measure)) {
          output.getPage(pageNumber - 1).drawText(word.text, { ...word, rotate: degrees(word.rotate), font, color: rgb(0, 0, 0), opacity: 0 });
          wordsFound += 1;
        }
      }

      setProgressMessage(t.ocr.assembling);
      setProgressPercent(96);

      const bytes = (await savePdf(output)).slice();

      if (wordsFound === 0 && !recognized.some(page => page.skipped)) {
        throw new KnownToolError(
          'unknown',
          t.ocr.noTextTitle,
          t.ocr.noTextBody
        );
      }

      const confidence = confidenceSummary(confidences);
      // A diagnostic report, not a claim that every possible PDF structure is understood.
      let lost: StructureCategory[] = [];
      try {
        const original = new Uint8Array(await file.arrayBuffer());
        lost = (await reportStructures(original, bytes)).losses.map((loss) => loss.category);
      } catch {
        lost = [];
      }

      setResult({
        pdf: new Blob([bytes], { type: 'application/pdf' }),
        recognized,
        text: fullText.trim(),
        pages: pageCount,
        wordsFound,
        meanConfidence: confidence.mean,
        lowConfidence: confidence.low,
        stripped,
        lost,
      });
      setReviewDirty(false);
      setProgressPercent(100);
    } catch (caught) {
      const described = describeError(caught, t);
      if (!signal.aborted && described.kind !== 'cancelled') setError(described);
    } finally {
      abortRef.current = null;
      await engine?.close();
      await pdfSource?.destroy().catch(() => {});
      setIsProcessing(false);
    }
  };

  const reread = async (pageResult: OcrPageResult, word: OcrWord) => {
    if (!file) throw new Error('No file');
    const controller = new AbortController();
    abortRef.current = controller;
    const source = await openPdf(await file.arrayBuffer());
    let engine: Awaited<ReturnType<typeof createOcrEngine>> | undefined;
    try {
      engine = await createOcrEngine(options, controller.signal);
      return await engine.reread(await source.document.getPage(pageResult.page), pageResult, word);
    } finally { await engine?.close(); await source.destroy(); if (abortRef.current === controller) abortRef.current = null; }
  };

  const updateReview = (recognized: OcrPageResult[]) => {
    setResult(current => current ? { ...current, recognized, stripped: recognized.flatMap(page => page.words).filter(word => losesCharacters(word.text)).length, text: recognized.map(page => `--- Page ${page.page} ---\n${page.text}`).join('\n\n') } : current);
    setReviewDirty(true);
  };

  const downloadReviewedPdf = async () => {
    if (!file || !result) return;
    setIsProcessing(true);
    try {
      let blob = result.pdf;
      if (reviewDirty) {
        const output = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
        const font = await output.embedFont(StandardFonts.Helvetica);
        for (const page of result.recognized) for (const word of layerWords(page, (text, size) => font.widthOfTextAtSize(text, size))) {
          output.getPage(page.page - 1).drawText(word.text, { ...word, rotate: degrees(word.rotate), font, opacity: 0 });
        }
        blob = new Blob([(await savePdf(output)).slice()], { type: 'application/pdf' });
        setResult(current => current ? { ...current, pdf: blob } : current);
        setReviewDirty(false);
      }
      downloadBlob(blob, derivedFileName(file.name, '_searchable.pdf'));
    } catch (caught) { setError(describeError(caught, t)); }
    finally { setIsProcessing(false); }
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
                    onFilesSelected={([selected]) => void selectFile(selected)}
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

                <OcrControls value={options} onChange={setOptions} disabled={isProcessing} />

                {hasRealText && !isProcessing && (
                  <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <div>
                      <p className="font-semibold">{t.ocr.hasTextTitle}</p>
                      <p className="mt-1 leading-relaxed">{locale === 'es' ? 'Las páginas con texto abundante se conservan sin otra capa OCR. Un escaneo con sólo un pie breve sí se lee, conservando ese pie sin duplicarlo.' : 'Pages with substantial text are preserved without another OCR layer. Scans with only a short footer are still recognized, preserving the footer without duplication.'}</p>
                    </div>
                  </div>
                )}

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
                <ResultHeading className="mb-2 text-center text-2xl font-semibold text-gray-900">
                  {result.wordsFound ? t.ocr.doneTitle(result.wordsFound) : locale === 'es' ? 'Se conservó el texto existente' : 'Existing text preserved'}
                </ResultHeading>
                <p className="mb-2 text-center text-gray-500">
                  {locale === 'es' ? `${result.pages} páginas procesadas; ${result.recognized.filter(page => page.skipped).length} conservadas sin otra capa OCR. El contenido visible no se reemplaza.` : `${result.pages} pages processed; ${result.recognized.filter(page => page.skipped).length} preserved without another OCR layer. Visible content is not replaced.`}
                </p>
                <p className="mb-6 text-center text-sm text-gray-500">
                  {result.wordsFound > 0 ? t.ocr.confidenceLine(result.meanConfidence) : ''}
                </p>

                {/* The engine's own doubt, when there is enough of it to matter:
                    a fifth of the words or more. A handful of uncertain words
                    is every scan; a fifth is a document to read before trusting
                    a search in it. */}
                {result.lowConfidence * 5 >= result.wordsFound && result.lowConfidence > 0 && (
                  <div className="mx-auto mb-4 max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">
                    {t.ocr.lowConfidenceNote(result.lowConfidence, result.wordsFound)}
                  </div>
                )}
                {result.stripped > 0 && (
                  <div className="mx-auto mb-4 max-w-xl rounded-2xl border border-gray-200 bg-gray-50 p-4 text-left text-sm text-gray-700">
                    {t.ocr.strippedNote(result.stripped)}
                  </div>
                )}

                    {result.lost.length > 0 && (
                  <div className="mx-auto mb-8 flex max-w-lg items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left">
                    <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <p className="text-sm text-amber-900">
                      {t.ocr.lostNote(
                        new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
                          result.lost.map((category) => t.structures[category])
                        )
                      )}
                    </p>
                  </div>
                )}
                <OcrReview results={result.recognized} onChange={updateReview} onReread={reread} disabled={isProcessing} />

                <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={downloadReviewedPdf}
                    disabled={isProcessing}
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
