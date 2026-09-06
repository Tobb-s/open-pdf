'use client';

import { useEffect, useRef, useState } from 'react';
import OcrControls from '@/components/OcrControls';
import OcrReview from '@/components/OcrReview';
import { DEFAULT_OCR_OPTIONS, type OcrPageResult } from '@/lib/ocrAdvanced';
import { exportOcrPages, summarizeOcrPages, type OcrResult } from '@/lib/ocrResult';
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

/** Pages sampled for an existing text layer when a file is chosen. */
const TEXT_SAMPLE_PAGES = 3;

export default function OcrPage() {
  const { locale, t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState(DEFAULT_OCR_OPTIONS);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [lost, setLost] = useState<StructureCategory[] | null>([]);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState<ToolError | null>(null);
  const [copied, setCopied] = useState(false);
  /** True when the chosen file already carries real text on its first pages. */
  const [hasRealText, setHasRealText] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const selectionRef = useRef(0);
  useEffect(() => () => {
    selectionRef.current++;
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!result && !isProcessing) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [result, isProcessing]);

  const resultText = result ? [
    result.partial ? (locale === 'es'
      ? `OCR PARCIAL: ${result.recognized.length} de ${result.pages} páginas procesadas. Las restantes todavía no se reconocieron.`
      : `PARTIAL OCR: ${result.recognized.length} of ${result.pages} pages processed. Remaining pages have not been recognized yet.`) : '',
    result.text,
  ].filter(Boolean).join('\n\n') : '';

  const reset = () => {
    if (abortRef.current) return;
    selectionRef.current++;
    setFile(null);
    setResult(null);
    setLost([]);
    setError(null);
    setHasRealText(false);
    setProgressPercent(0);
    setProgressMessage('');
  };

  /** Sample only for advice; recognition checks every page independently. */
  const selectFile = async (selected: File) => {
    if (abortRef.current) return;
    const selection = ++selectionRef.current;
    setFile(selected);
    setResult(null);
    setLost([]);
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
    if (!file || abortRef.current || (result && !result.partial)) return;

    const selection = selectionRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    setIsProcessing(true);
    setIsRecognizing(true);
    setError(null);
    setLost([]);
    setProgressPercent(2);
    setProgressMessage(t.ocr.starting);

    let engine: Awaited<ReturnType<typeof createOcrEngine>> | null = null;
    let pdfSource: Awaited<ReturnType<typeof openPdf>> | null = null;

    try {
      assertFileSize(file, t);

      setProgressPercent(8);
      setProgressMessage(t.ocr.reading);

      pdfSource = await openPdf(await file.arrayBuffer());
      const pageCount = pdfSource.document.numPages;
      assertPageCount(pageCount, MAX_OCR_PAGES, 'ocr', t);
      throwIfCancelled(signal, t);
      engine = await createOcrEngine(options, signal);
      const recognized = result?.recognized.slice() ?? [];
      summarizeOcrPages(recognized, pageCount);

      for (let pageNumber = recognized.length + 1; pageNumber <= pageCount; pageNumber += 1) {
        throwIfCancelled(signal, t);
        setProgressPercent(8 + ((pageNumber - 1) / pageCount) * 86);
        setProgressMessage(t.ocr.readingPage(pageNumber, pageCount));

        const page = await pdfSource.document.getPage(pageNumber);

        const recognizedPage = await engine.page(page, detail => setProgressMessage(`${t.ocr.readingPage(pageNumber, pageCount)} · ${detail}`));
        throwIfCancelled(signal, t);
        recognized.push(recognizedPage);
        // Publish the checkpoint before starting the next page. A failure never clears it.
        if (selection === selectionRef.current) {
          setResult(summarizeOcrPages(recognized, pageCount));
        }
      }

      if (!recognized.some(page => page.words.length || page.skipped)) {
        throw new KnownToolError(
          'unknown',
          t.ocr.noTextTitle,
          t.ocr.noTextBody
        );
      }

      setProgressPercent(100);
    } catch (caught) {
      const described = describeError(caught, t);
      if (selection === selectionRef.current && !signal.aborted && described.kind !== 'cancelled') setError(described);
    } finally {
      await engine?.close().catch(() => {});
      await pdfSource?.destroy().catch(() => {});
      if (abortRef.current === controller) abortRef.current = null;
      if (selection === selectionRef.current) {
        setIsProcessing(false);
        setIsRecognizing(false);
      }
    }
  };

  const reread = async (pageResult: OcrPageResult, word: OcrWord) => {
    if (!file || abortRef.current) throw new Error('OCR unavailable');
    const controller = new AbortController();
    abortRef.current = controller;
    setIsProcessing(true);
    let source: Awaited<ReturnType<typeof openPdf>> | undefined;
    let engine: Awaited<ReturnType<typeof createOcrEngine>> | undefined;
    try {
      source = await openPdf(await file.arrayBuffer());
      throwIfCancelled(controller.signal, t);
      engine = await createOcrEngine(options, controller.signal);
      return await engine.reread(await source.document.getPage(pageResult.page), pageResult, word);
    } finally {
      await engine?.close().catch(() => {});
      await source?.destroy().catch(() => {});
      if (abortRef.current === controller) { abortRef.current = null; setIsProcessing(false); }
    }
  };

  const updateReview = (recognized: OcrPageResult[]) => {
    if (abortRef.current) return;
    setResult(current => current ? summarizeOcrPages(recognized, current.pages) : current);
    setLost([]);
  };

  const downloadReviewedPdf = async () => {
    if (!file || !result || abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsProcessing(true);
    setError(null);
    try {
      const original = await file.arrayBuffer();
      const bytes = await exportOcrPages(original, result.recognized);
      throwIfCancelled(controller.signal, t);
      try {
        const report = await reportStructures(new Uint8Array(original), bytes);
        if (!controller.signal.aborted) setLost(report.losses.map(loss => loss.category));
      } catch {
        if (!controller.signal.aborted) setLost(null);
      }
      throwIfCancelled(controller.signal, t);
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), derivedFileName(file.name, result.partial ? '_searchable_partial.pdf' : '_searchable.pdf'));
    } catch (caught) { if (!controller.signal.aborted) setError(describeError(caught, t)); }
    finally { if (abortRef.current === controller) { abortRef.current = null; setIsProcessing(false); } }
  };

  const copyText = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(resultText);
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
          {!result || isRecognizing ? (
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

                <OcrControls value={options} onChange={setOptions} disabled={isProcessing || !!result} />

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
                <div className={cn('mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full', result.partial ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-600')}>
                  {result.partial ? <AlertTriangle className="h-8 w-8" /> : <CheckCircle2 className="h-8 w-8" />}
                </div>
                <ResultHeading className="mb-2 text-center text-2xl font-semibold text-gray-900">
                  {result.partial ? (locale === 'es' ? 'OCR parcial — avance conservado' : 'Partial OCR — progress retained') : result.wordsFound ? t.ocr.doneTitle(result.wordsFound) : result.recognized.some(page => page.skipped) ? (locale === 'es' ? 'Se conservó el texto existente' : 'Existing text preserved') : t.ocr.noTextTitle}
                </ResultHeading>
                <p className="mb-2 text-center text-gray-500">
                  {locale === 'es' ? `${result.recognized.length} de ${result.pages} páginas procesadas; ${result.recognized.filter(page => page.skipped).length} conservadas sin otra capa OCR. El contenido visible no se reemplaza.` : `${result.recognized.length} of ${result.pages} pages processed; ${result.recognized.filter(page => page.skipped).length} preserved without another OCR layer. Visible content is not replaced.`}
                </p>
                <p className="mb-4 text-center text-sm text-amber-800">
                  {locale === 'es' ? 'El avance se conserva en esta pestaña. Recargarla, cerrarla o cambiar de herramienta lo borra; descargá una copia antes.' : 'Progress is retained in this tab. Reloading, closing it or changing tools clears it; download a copy first.'}
                </p>
                {result.partial && <div className="mb-4 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p>{locale === 'es' ? `Podés reanudar desde la página ${result.recognized.length + 1}, incluso después de un error. La descarga parcial mantiene las ${result.pages} páginas originales, pero sólo las primeras ${result.recognized.length} fueron procesadas por OCR.` : `You can resume from page ${result.recognized.length + 1}, even after an error. The partial download retains all ${result.pages} original pages, but only the first ${result.recognized.length} have been processed by OCR.`}</p>
                  <button type="button" disabled={isProcessing} onClick={runOcr} className="rounded-xl bg-orange-600 px-4 py-2 text-white disabled:opacity-50">
                    {locale === 'es' ? `Reanudar desde la página ${result.recognized.length + 1}` : `Resume from page ${result.recognized.length + 1}`}
                  </button>
                </div>}
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

                {lost === null && <p role="status" className="mb-4 text-sm text-amber-800">{locale === 'es' ? 'No se pudo completar la verificación de estructuras del PDF exportado. Revisá el archivo descargado.' : 'The exported PDF structure check could not be completed. Review the downloaded file.'}</p>}
                    {lost && lost.length > 0 && (
                  <div className="mx-auto mb-8 flex max-w-lg items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left">
                    <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <p className="text-sm text-amber-900">
                      {t.ocr.lostNote(
                        new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
                          lost.map((category) => t.structures[category])
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
                        {result.partial ? (locale === 'es' ? 'PDF buscable parcial' : 'Partial searchable PDF') : t.ocr.searchablePdf}
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
                        new Blob([resultText], { type: 'text/plain;charset=utf-8' }),
                        derivedFileName(file.name, result.partial ? '_extracted_partial.txt' : '_extracted.txt')
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
                      {resultText}
                    </pre>
                  </div>
                </div>

                <div className="text-center">
                  <button type="button" disabled={isProcessing} onClick={() => { if (!abortRef.current) { setResult(null); setLost([]); setError(null); } }} className="mb-3 block w-full text-sm text-gray-500 underline disabled:opacity-50">
                    {locale === 'es' ? 'Descartar avance y cambiar opciones OCR' : 'Discard progress and change OCR options'}
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    disabled={isProcessing}
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
