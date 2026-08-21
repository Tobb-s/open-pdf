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
  Pills,
  PageScopePicker,
  SliderRow,
  type PageScope,
} from '@/components/StampControls';
import { Download, FileText, ImageUp, Loader2, Upload, X } from 'lucide-react';
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
  imageKind,
  stampImage,
  stampText,
  UnsupportedCharacterError,
  type FontChoice,
} from '@/lib/stamp';

type Kind = 'text' | 'image';

export default function WatermarkPage() {
  const { t } = useI18n();

  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [kind, setKind] = useState<Kind>('text');
  const [text, setText] = useState('BORRADOR');
  const [font, setFont] = useState<FontChoice>({ family: 'helvetica', bold: true, italic: false });
  const [size, setSize] = useState(48);
  const [color, setColor] = useState('#888888');
  const [opacity, setOpacity] = useState(0.25);
  const [tilt, setTilt] = useState(45);
  const [anchor, setAnchor] = useState<Anchor>('center');
  const [margin, setMargin] = useState(36);
  const [scope, setScope] = useState<PageScope>({ mode: 'all', range: '' });
  const [image, setImage] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [imageWidth, setImageWidth] = useState(0.3);

  const [isWorking, setIsWorking] = useState(false);
  const [result, setResult] = useState<{ blob: Blob; pages: number } | null>(null);
  const [error, setError] = useState<ToolError | null>(null);

  // The document lives in state rather than a ref because the preview needs to
  // read it while rendering.
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

  const reset = () => {
    setBytes(null);
    setImage(null);
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

  const selectImage = async (selected: File) => {
    try {
      assertFileSize(selected, t);
      const chosen = new Uint8Array(await selected.arrayBuffer());
      if (imageKind(chosen) === null) {
        setError({
          kind: 'invalid',
          title: t.watermark.chooseImage,
          detail: t.watermark.imageNote,
        });
        return;
      }
      setImage({ name: selected.name, bytes: chosen });
      setError(null);
    } catch (caught) {
      setError(describeError(caught, t));
    }
  };

  /** The one place the drawing is described, used by the preview and by Apply. */
  const applyTo = async (document: PDFDocument, pageNumbers: readonly number[]) => {
    if (kind === 'image') {
      if (!image) return;
      await stampImage(document, pageNumbers, {
        bytes: image.bytes,
        opacity,
        angle: tilt,
        anchor,
        margin,
        widthFraction: imageWidth,
      });
      return;
    }
    await stampText(document, pageNumbers, {
      text,
      font,
      size,
      color: hexToRgb(color),
      opacity,
      angle: tilt,
      anchor,
      margin,
    });
  };

  const ready = kind === 'text' ? text.trim() !== '' : image !== null;

  const apply = async () => {
    if (!bytes) return;

    if (!ready) {
      setError({
        kind: 'unknown',
        title: t.watermark.nothingTitle,
        detail: t.watermark.nothingBody,
      });
      return;
    }
    if (selection.pages.length === 0) {
      setError({ kind: 'invalid', title: t.stamp.whichPages, detail: t.stamp.rangeEmpty });
      return;
    }

    setIsWorking(true);
    setError(null);

    try {
      // In place, on the reader's own document — the watermark is an addition,
      // not a reason to lose the form fields or the bookmarks.
      const document = await loadPdf(bytes, { updateMetadata: false });
      await applyTo(document, selection.pages);
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
                t.watermark.nothingTitle,
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
  const signature = JSON.stringify([
    kind,
    text,
    font,
    size,
    color,
    opacity,
    tilt,
    anchor,
    margin,
    image?.name ?? null,
    imageWidth,
    previewPage,
  ]);

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-12 text-center">
          <h1 className="mb-4 text-4xl font-bold text-gray-900">{t.watermark.heading}</h1>
          <p className="text-gray-600">{t.watermark.intro}</p>
        </div>

        {!file ? (
          <div className="space-y-6">
            <FileDropzone
              inputId="watermark-file-input"
              kind={PDF_FILES}
              onFilesSelected={([selected]) => void selectFile(selected)}
              className="cursor-pointer rounded-3xl border-2 border-dashed border-gray-300 bg-white p-12 text-center transition-all hover:border-rose-400"
            >
              <div className="flex flex-col items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-500">
                  <Upload className="h-8 w-8" />
                </div>
                <div>
                  <p className="text-lg font-semibold">{t.watermark.choose}</p>
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
            <h2 className="mb-2 text-2xl font-bold">{t.watermark.doneTitle(result.pages)}</h2>
            <p className="mb-8 text-gray-600">{t.watermark.doneBody}</p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <button
                type="button"
                onClick={() =>
                  downloadBlob(result.blob, derivedFileName(file.name, '_watermarked.pdf'))
                }
                className="flex items-center gap-2 rounded-full bg-rose-500 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-rose-200 transition-all hover:bg-rose-600"
              >
                <Download className="h-5 w-5" />
                {t.common.download}
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-full bg-gray-100 px-8 py-4 text-lg font-bold text-gray-700 transition-all hover:bg-gray-200"
              >
                {t.watermark.another}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between rounded-2xl border bg-white p-4">
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-6 w-6 shrink-0 text-rose-500" />
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
                <Field label={t.watermark.kind}>
                  <Pills
                    label={t.watermark.kind}
                    value={kind}
                    options={[
                      { value: 'text' as const, label: t.watermark.kindText },
                      { value: 'image' as const, label: t.watermark.kindImage },
                    ]}
                    onChange={setKind}
                  />
                </Field>

                {kind === 'text' ? (
                  <>
                    <Field label={t.watermark.text}>
                      <input
                        type="text"
                        value={text}
                        placeholder={t.watermark.textPlaceholder}
                        aria-label={t.watermark.text}
                        onChange={(event) => setText(event.target.value)}
                        className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-rose-400"
                      />
                    </Field>

                    <Field label={t.stamp.typeface}>
                      <FontPicker value={font} onChange={setFont} />
                    </Field>

                    <div className="flex flex-wrap gap-8">
                      <NumberRow label={t.stamp.size} value={size} min={4} max={288} onChange={setSize} />
                      <ColorRow label={t.stamp.color} value={color} onChange={setColor} />
                    </div>
                  </>
                ) : (
                  <Field label={t.watermark.kindImage} hint={t.watermark.imageNote}>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
                        <ImageUp className="h-4 w-4" />
                        {image ? t.watermark.changeImage : t.watermark.chooseImage}
                        <input
                          type="file"
                          accept="image/png,image/jpeg"
                          className="hidden"
                          onChange={(event) => {
                            const chosen = event.target.files?.[0];
                            if (chosen) void selectImage(chosen);
                          }}
                        />
                      </label>
                      {image && (
                        <span className="truncate text-sm text-gray-500">
                          {t.watermark.imageChosen(image.name)}
                        </span>
                      )}
                    </div>
                    {image && (
                      <div className="pt-3">
                        <SliderRow
                          label={t.watermark.imageWidth}
                          value={imageWidth}
                          min={0.05}
                          max={1}
                          step={0.05}
                          format={(value) => `${Math.round(value * 100)} %`}
                          onChange={setImageWidth}
                        />
                      </div>
                    )}
                  </Field>
                )}

                <SliderRow
                  label={t.watermark.opacity}
                  value={opacity}
                  min={0.05}
                  max={1}
                  step={0.05}
                  format={(value) => `${Math.round(value * 100)} %`}
                  onChange={setOpacity}
                />

                <SliderRow
                  label={t.watermark.tilt}
                  value={tilt}
                  min={-90}
                  max={90}
                  step={5}
                  format={(value) => `${value}°`}
                  onChange={setTilt}
                />

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
                  apply={(document) => applyTo(document, [1])}
                />

                <button
                  type="button"
                  onClick={apply}
                  disabled={isWorking || selection.pages.length === 0}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-rose-500 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-rose-200 transition-all hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
                >
                  {isWorking ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" /> {t.watermark.working}
                    </>
                  ) : (
                    t.watermark.action
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
