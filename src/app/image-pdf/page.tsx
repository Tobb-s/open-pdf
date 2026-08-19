'use client';

import { useEffect, useRef, useState } from 'react';
import { PDFDocument, PageSizes } from 'pdf-lib';
import JSZip from 'jszip';
import Navbar from '@/components/Navbar';
import FileDropzone, { IMAGE_FILES, PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import ProgressPanel from '@/components/ProgressPanel';
import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileImage,
  FileText,
  Image as ImageIcon,
  Settings,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { describeError, KnownToolError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob, formatBytes } from '@/lib/files';
import {
  assertFileSize,
  assertPageCount,
  MAX_RENDERED_PAGES,
  throwIfCancelled,
} from '@/lib/limits';
import { openPdf, renderPageToJpeg } from '@/lib/pdfjs';

type Mode = 'select' | 'pdf-to-jpg' | 'jpg-to-pdf';
type Margin = 'none' | 'small' | 'big';
type Orientation = 'portrait' | 'landscape' | 'auto';

const MARGIN_POINTS: Record<Margin, number> = { none: 0, small: 20, big: 50 };

const MARGIN_OPTIONS: { id: Margin; label: string }[] = [
  { id: 'none', label: 'No margin' },
  { id: 'small', label: 'Small margin' },
  { id: 'big', label: 'Big margin' },
];

interface ImageItem {
  id: number;
  file: File;
  previewUrl: string;
}

/**
 * pdf-lib embeds PNG and JPEG only. Anything else — WebP above all, which the
 * picker accepts — is redrawn through a canvas first. Previously every non-PNG
 * went straight to `embedJpg`, so a single WebP threw and took the whole batch
 * down with a generic message.
 */
async function toEmbeddable(file: File): Promise<{ bytes: Uint8Array; format: 'png' | 'jpg' }> {
  if (file.type === 'image/png') {
    return { bytes: new Uint8Array(await file.arrayBuffer()), format: 'png' };
  }
  if (file.type === 'image/jpeg') {
    return { bytes: new Uint8Array(await file.arrayBuffer()), format: 'jpg' };
  }

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    throw new KnownToolError(
      'unsupported-image',
      `${file.name} could not be read`,
      'This browser could not decode the image. Save it as JPG or PNG and try again.'
    );
  }

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new KnownToolError(
      'unsupported-image',
      `${file.name} could not be converted`,
      'The browser did not provide a canvas to convert the image with.'
    );
  }

  // A white ground, so transparency does not come out black in the PDF.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.92);
  });
  canvas.width = 0;
  canvas.height = 0;

  if (!blob) {
    throw new KnownToolError(
      'unsupported-image',
      `${file.name} could not be converted`,
      'The browser failed to encode the converted image.'
    );
  }
  return { bytes: new Uint8Array(await blob.arrayBuffer()), format: 'jpg' };
}

export default function ImagePdfPage() {
  const [mode, setMode] = useState<Mode>('select');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [error, setError] = useState<ToolError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [zipResult, setZipResult] = useState<{ blob: Blob; pages: number } | null>(null);

  const [images, setImages] = useState<ImageItem[]>([]);
  const [pdfResult, setPdfResult] = useState<Blob | null>(null);
  const [margin, setMargin] = useState<Margin>('none');
  const [orientation, setOrientation] = useState<Orientation>('auto');
  const nextImageId = useRef(1);

  // One object URL per file, revoked when the file goes away and when the page
  // unmounts. The previous version minted a fresh URL on every render and never
  // revoked any of them.
  const imagesRef = useRef<ImageItem[]>([]);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(
    () => () => {
      for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl);
    },
    []
  );

  const addImages = (files: File[]) => {
    setError(null);
    setImages((previous) => [
      ...previous,
      ...files.map((file) => ({
        id: nextImageId.current++,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  };

  const removeImage = (id: number) => {
    setImages((previous) => {
      const target = previous.find((image) => image.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return previous.filter((image) => image.id !== id);
    });
  };

  const goToMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const convertPdfToJpg = async () => {
    if (!pdfFile) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setIsProcessing(true);
    setError(null);
    setProgressPercent(4);
    setProgressMessage('Reading the document…');

    let source: Awaited<ReturnType<typeof openPdf>> | null = null;

    try {
      assertFileSize(pdfFile);
      source = await openPdf(await pdfFile.arrayBuffer());

      const pageCount = source.document.numPages;
      assertPageCount(pageCount, MAX_RENDERED_PAGES, 'this conversion');

      const zip = new JSZip();
      const width = String(pageCount).length;

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        throwIfCancelled(controller.signal);
        setProgressPercent(4 + (pageNumber / pageCount) * 88);
        setProgressMessage(`Converting page ${pageNumber} of ${pageCount}…`);

        const page = await source.document.getPage(pageNumber);
        const { blob } = await renderPageToJpeg(page, 2, 0.95);
        page.cleanup();

        zip.file(`page_${String(pageNumber).padStart(width, '0')}.jpg`, blob);
      }

      setProgressMessage('Packing the ZIP…');
      setProgressPercent(96);
      const blob = await zip.generateAsync({ type: 'blob' });

      setZipResult({ blob, pages: pageCount });
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

  const convertJpgToPdf = async () => {
    if (images.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setIsProcessing(true);
    setError(null);
    setProgressPercent(6);
    setProgressMessage('Preparing the PDF…');

    try {
      const document_ = await PDFDocument.create();
      const padding = MARGIN_POINTS[margin];

      for (let index = 0; index < images.length; index += 1) {
        throwIfCancelled(controller.signal);
        setProgressPercent(6 + (index / images.length) * 88);
        setProgressMessage(`Adding image ${index + 1} of ${images.length}…`);

        const { file } = images[index];
        assertFileSize(file);

        const { bytes, format } = await toEmbeddable(file);
        const image =
          format === 'png' ? await document_.embedPng(bytes) : await document_.embedJpg(bytes);

        // "Auto" follows each image, so a landscape photo no longer sits letterboxed
        // in the middle of a portrait page.
        const landscape =
          orientation === 'auto' ? image.width > image.height : orientation === 'landscape';
        const [pageWidth, pageHeight] = landscape
          ? [PageSizes.A4[1], PageSizes.A4[0]]
          : [PageSizes.A4[0], PageSizes.A4[1]];

        const page = document_.addPage([pageWidth, pageHeight]);
        const fitted = image.scaleToFit(pageWidth - padding * 2, pageHeight - padding * 2);

        page.drawImage(image, {
          x: (pageWidth - fitted.width) / 2,
          y: (pageHeight - fitted.height) / 2,
          width: fitted.width,
          height: fitted.height,
        });
      }

      setProgressMessage('Saving…');
      setProgressPercent(96);
      const bytes = (await document_.save()).slice();

      setPdfResult(new Blob([bytes], { type: 'application/pdf' }));
      setProgressPercent(100);
    } catch (caught) {
      const described = describeError(caught);
      if (described.kind !== 'cancelled') setError(described);
    } finally {
      abortRef.current = null;
      setIsProcessing(false);
    }
  };

  const renderModeChooser = () => (
    <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 sm:grid-cols-2">
      <button
        type="button"
        onClick={() => goToMode('pdf-to-jpg')}
        className="group relative overflow-hidden rounded-3xl border-2 border-orange-100 bg-white p-10 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-orange-500 hover:shadow-xl"
      >
        <div className="absolute right-0 top-0 -mr-16 -mt-16 h-32 w-32 rounded-bl-full bg-orange-50 transition-transform group-hover:scale-110" />
        <div className="relative">
          <div className="mb-6 flex items-center gap-4">
            <div className="rounded-2xl bg-orange-100 p-4 text-orange-600">
              <FileText className="h-8 w-8" />
            </div>
            <ArrowRight className="h-6 w-6 text-gray-300 transition-colors group-hover:text-orange-500" />
            <div className="rounded-2xl bg-yellow-100 p-4 text-yellow-600">
              <ImageIcon className="h-8 w-8" />
            </div>
          </div>
          <h2 className="mb-2 text-2xl font-bold text-gray-900">PDF to JPG</h2>
          <p className="leading-relaxed text-gray-500">
            Turn every page of a PDF into a high-quality JPG image, delivered as a ZIP.
          </p>
        </div>
      </button>

      <button
        type="button"
        onClick={() => goToMode('jpg-to-pdf')}
        className="group relative overflow-hidden rounded-3xl border-2 border-yellow-100 bg-white p-10 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-yellow-500 hover:shadow-xl"
      >
        <div className="absolute right-0 top-0 -mr-16 -mt-16 h-32 w-32 rounded-bl-full bg-yellow-50 transition-transform group-hover:scale-110" />
        <div className="relative">
          <div className="mb-6 flex items-center gap-4">
            <div className="rounded-2xl bg-yellow-100 p-4 text-yellow-600">
              <ImageIcon className="h-8 w-8" />
            </div>
            <ArrowRight className="h-6 w-6 text-gray-300 transition-colors group-hover:text-yellow-500" />
            <div className="rounded-2xl bg-orange-100 p-4 text-orange-600">
              <FileText className="h-8 w-8" />
            </div>
          </div>
          <h2 className="mb-2 text-2xl font-bold text-gray-900">Images to PDF</h2>
          <p className="leading-relaxed text-gray-500">
            Combine JPG, PNG or WebP images into one PDF. Choose the orientation and margins.
          </p>
        </div>
      </button>
    </div>
  );

  const backButton = (
    <button
      type="button"
      onClick={() => goToMode('select')}
      aria-label="Back to the tool chooser"
      className="text-gray-400 transition-colors hover:text-gray-600"
    >
      <ArrowRight className="h-6 w-6 rotate-180" />
    </button>
  );

  const renderPdfToJpg = () => (
    <div className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-gray-100 bg-white p-8 shadow-sm sm:p-12">
      <div className="mb-8 flex items-center gap-3">
        {backButton}
        <h2 className="flex items-center gap-3 text-2xl font-bold text-gray-900">
          <FileText className="h-6 w-6 text-orange-500" />
          PDF to JPG
        </h2>
      </div>

      {!zipResult ? (
        <div className="space-y-6">
          {!pdfFile ? (
            <FileDropzone
              inputId="pdf-to-jpg-input"
              kind={PDF_FILES}
              disabled={isProcessing}
              onFilesSelected={([selected]) => setPdfFile(selected)}
              className="flex h-48 w-full cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-gray-300 bg-gray-50 transition-all hover:border-orange-400 hover:bg-gray-100"
            >
              <UploadCloud className="mb-4 h-12 w-12 text-gray-400" />
              <p className="text-lg font-medium text-gray-700">Choose a PDF</p>
              <p className="mt-1 text-sm text-gray-500">or drop one here</p>
            </FileDropzone>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between rounded-2xl border border-orange-100 bg-orange-50 p-5">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="rounded-xl bg-white p-3 text-orange-600 shadow-sm">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-900">{pdfFile.name}</p>
                    <p className="text-sm text-gray-500">{formatBytes(pdfFile.size)}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPdfFile(null)}
                  disabled={isProcessing}
                  aria-label="Remove this file"
                  className="rounded-full p-2 text-gray-400 transition-colors hover:bg-white hover:text-red-500 disabled:opacity-50"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <ErrorNotice error={error} onDismiss={() => setError(null)} />

              {isProcessing && (
                <ProgressPanel
                  accent="orange"
                  message={progressMessage}
                  percent={progressPercent}
                  onCancel={() => abortRef.current?.abort()}
                />
              )}

              <button
                type="button"
                onClick={convertPdfToJpg}
                disabled={isProcessing}
                className="w-full rounded-2xl bg-orange-600 py-4 text-lg font-bold text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
              >
                {isProcessing ? 'Converting…' : 'Convert to JPG'}
              </button>
            </div>
          )}
          {!pdfFile && <ErrorNotice error={error} onDismiss={() => setError(null)} />}
        </div>
      ) : (
        <div className="py-8 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-600">
            <CheckCircle2 className="h-10 w-10" />
          </div>
          <h3 className="mb-2 text-2xl font-bold text-gray-900">
            {zipResult.pages} {zipResult.pages === 1 ? 'image' : 'images'} ready
          </h3>
          <p className="mb-8 text-gray-500">{formatBytes(zipResult.blob.size)} in one ZIP.</p>

          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <button
              type="button"
              onClick={() =>
                pdfFile && downloadBlob(zipResult.blob, derivedFileName(pdfFile.name, '_images.zip'))
              }
              className="flex items-center justify-center gap-2 rounded-full bg-orange-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-orange-200 transition-all hover:bg-orange-700"
            >
              <Download className="h-5 w-5" />
              Download ZIP
            </button>
            <button
              type="button"
              onClick={() => {
                setZipResult(null);
                setPdfFile(null);
                setProgressPercent(0);
              }}
              className="rounded-full bg-gray-100 px-8 py-4 text-lg font-bold text-gray-700 transition-all hover:bg-gray-200"
            >
              Convert another
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderJpgToPdf = () => (
    <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 lg:grid-cols-3">
      <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white p-8 shadow-sm lg:col-span-2">
        <div className="mb-8 flex items-center gap-3">
          {backButton}
          <h2 className="flex items-center gap-3 text-2xl font-bold text-gray-900">
            <ImageIcon className="h-6 w-6 text-yellow-500" />
            Images to PDF
          </h2>
        </div>

        {!pdfResult ? (
          <div className="space-y-6">
            {images.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {images.map((image) => (
                    <div
                      key={image.id}
                      className="group relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, which next/image cannot optimise */}
                      <img
                        src={image.previewUrl}
                        alt={image.file.name}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          type="button"
                          onClick={() => removeImage(image.id)}
                          aria-label={`Remove ${image.file.name}`}
                          className="rounded-full bg-white p-2 text-red-500 transition-transform hover:scale-110"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  ))}

                  <FileDropzone
                    inputId="image-add-more"
                    kind={IMAGE_FILES}
                    multiple
                    disabled={isProcessing}
                    onFilesSelected={addImages}
                    className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 text-gray-500 transition-all hover:border-yellow-500 hover:bg-yellow-50 hover:text-yellow-600"
                  >
                    <UploadCloud className="mb-2 h-8 w-8" />
                    <span className="font-medium">Add more</span>
                  </FileDropzone>
                </div>
                <p className="text-sm text-gray-500">
                  {images.length} {images.length === 1 ? 'image' : 'images'}, in the order shown.
                </p>
              </>
            ) : (
              <FileDropzone
                inputId="image-upload"
                kind={IMAGE_FILES}
                multiple
                disabled={isProcessing}
                onFilesSelected={addImages}
                className="flex h-64 w-full cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-gray-300 bg-gray-50 transition-all hover:border-yellow-400 hover:bg-gray-100"
              >
                <FileImage className="mb-4 h-16 w-16 text-gray-400" />
                <p className="text-xl font-medium text-gray-700">Choose images</p>
                <p className="mt-2 text-sm text-gray-500">
                  JPG, PNG and WebP. Drop several at once.
                </p>
              </FileDropzone>
            )}

            <ErrorNotice error={error} onDismiss={() => setError(null)} />

            {isProcessing && (
              <ProgressPanel
                message={progressMessage}
                percent={progressPercent}
                onCancel={() => abortRef.current?.abort()}
              />
            )}
          </div>
        ) : (
          <div className="py-12 text-center">
            <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-green-100 text-green-600">
              <CheckCircle2 className="h-12 w-12" />
            </div>
            <h3 className="mb-3 text-3xl font-bold text-gray-900">Your PDF is ready</h3>
            <p className="mb-10 text-lg text-gray-500">
              {images.length} {images.length === 1 ? 'image' : 'images'} ·{' '}
              {formatBytes(pdfResult.size)}
            </p>

            <div className="flex flex-col justify-center gap-4 sm:flex-row">
              <button
                type="button"
                onClick={() => downloadBlob(pdfResult, 'images.pdf')}
                className="flex items-center justify-center gap-3 rounded-full bg-yellow-500 px-10 py-4 text-xl font-bold text-white shadow-xl shadow-yellow-200 transition-all hover:bg-yellow-600"
              >
                <Download className="h-6 w-6" />
                Download PDF
              </button>
              <button
                type="button"
                onClick={() => setPdfResult(null)}
                className="rounded-full bg-gray-100 px-8 py-4 text-lg font-bold text-gray-700 transition-all hover:bg-gray-200"
              >
                Change images
              </button>
            </div>
          </div>
        )}
      </div>

      {!pdfResult && (
        <div className="h-fit rounded-3xl border border-gray-100 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-2 text-lg font-bold text-gray-900">
            <Settings className="h-5 w-5 text-gray-400" />
            Page setup
          </div>

          <div className="space-y-6">
            <fieldset>
              <legend className="mb-3 block text-sm font-semibold text-gray-700">
                Orientation
              </legend>
              <div className="space-y-2">
                {(['auto', 'portrait', 'landscape'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setOrientation(option)}
                    aria-pressed={orientation === option}
                    className={cn(
                      'flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-medium capitalize transition-all',
                      orientation === option
                        ? 'border-yellow-500 bg-yellow-50 text-yellow-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    )}
                  >
                    {option === 'auto' ? 'Match each image' : option}
                    {orientation === option && <CheckCircle2 className="h-4 w-4" />}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-3 block text-sm font-semibold text-gray-700">Margins</legend>
              <div className="space-y-2">
                {MARGIN_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setMargin(option.id)}
                    aria-pressed={margin === option.id}
                    className={cn(
                      'flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all',
                      margin === option.id
                        ? 'border-yellow-500 bg-yellow-50 text-yellow-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    )}
                  >
                    {option.label}
                    {margin === option.id && <CheckCircle2 className="h-4 w-4" />}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="border-t border-gray-100 pt-6">
              <button
                type="button"
                onClick={convertJpgToPdf}
                disabled={images.length === 0 || isProcessing}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-yellow-500 py-4 text-lg font-bold text-white shadow-md transition-colors hover:bg-yellow-600 disabled:opacity-50"
              >
                {isProcessing ? 'Creating…' : 'Create PDF'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50">
      <Navbar />
      <main className="w-full flex-1 px-4 py-12">
        <div className="mb-12 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-yellow-100/70 px-3 py-1 text-xs font-semibold text-yellow-700">
            <Settings className="h-3.5 w-3.5 fill-yellow-600 text-yellow-600" />
            Runs entirely in your browser
          </div>
          <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
            Images &amp; PDF
          </h1>
          <p className="mx-auto max-w-xl text-lg text-gray-600">
            {mode === 'select' && 'Pick a direction. Both run on your device.'}
            {mode === 'pdf-to-jpg' && 'Turn each page of a PDF into a JPG image.'}
            {mode === 'jpg-to-pdf' && 'Combine several images into a single PDF.'}
          </p>
        </div>

        {mode === 'select' && renderModeChooser()}
        {mode === 'pdf-to-jpg' && renderPdfToJpg()}
        {mode === 'jpg-to-pdf' && renderJpgToPdf()}
      </main>
    </div>
  );
}
