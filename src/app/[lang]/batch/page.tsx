'use client';

import { useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  FileStack,
  Loader2,
  Play,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import ErrorNotice from '@/components/ErrorNotice';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import { useI18n } from '@/lib/i18n/context';
import { applyBatchRecipe, batchOutputName, hasBatchAction, type BatchRecipe } from '@/lib/batch';
import { describeError, type ToolError } from '@/lib/errors';
import { downloadBlob, formatBytes } from '@/lib/files';
import { sha256Hex } from '@/lib/hash';
import {
  assertFileSize,
  MAX_BATCH_OUTPUT_BYTES,
  MAX_STRUCTURAL_BYTES,
  yieldToBrowser,
} from '@/lib/limits';
import { openPdf } from '@/lib/pdfjs';

const MAX_FILES = 50;

interface SuccessRow {
  input: string;
  output: string;
  pages: number;
  flattenedFields: number;
  signedInput: boolean;
  inputBytes: number;
  outputBytes: number;
  inputSha256: string;
  outputSha256: string;
}

interface FailureRow {
  input: string;
  error: string;
}

interface BatchResult {
  zip: Blob;
  successes: SuccessRow[];
  failures: FailureRow[];
  cancelled: boolean;
}

function ToggleRow({
  checked,
  onChange,
  label,
  note,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  note?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-fuchsia-600"
      />
      <span>
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        {note && <span className="mt-0.5 block text-xs text-gray-600">{note}</span>}
      </span>
    </label>
  );
}

export default function BatchPage() {
  const { locale, t } = useI18n();
  const [files, setFiles] = useState<File[]>([]);
  const [recipe, setRecipe] = useState<BatchRecipe>({
    rotate: 0,
    watermark: '',
    pageNumbers: false,
    flattenForms: false,
  });
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<{ current: number; name: string } | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<ToolError | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const addFiles = (selected: File[]) => {
    setResult(null);
    setFiles((current) => {
      const combined = [...current, ...selected];
      if (combined.length > MAX_FILES) {
        setError({ kind: 'too-large', title: t.batch.heading, detail: t.batch.tooManyFiles });
      }
      return combined.slice(0, MAX_FILES);
    });
  };

  const reset = () => {
    setFiles([]);
    setResult(null);
    setError(null);
    setProgress(null);
  };

  const processBatch = async () => {
    if (files.length === 0 || working) return;
    if (!hasBatchAction(recipe)) {
      setError({ kind: 'invalid', title: t.batch.noActionTitle, detail: t.batch.noActionBody });
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setWorking(true);
    setResult(null);
    setError(null);

    const zip = new JSZip();
    const successes: SuccessRow[] = [];
    const failures: FailureRow[] = [];
    let heldBytes = 0;
    let cancelled = false;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (controller.signal.aborted) {
        cancelled = true;
        break;
      }
      setProgress({ current: index + 1, name: file.name });
      await yieldToBrowser();

      try {
        assertFileSize(file, t, MAX_STRUCTURAL_BYTES);
        const source = new Uint8Array(await file.arrayBuffer());
        const inputSha256 = await sha256Hex(source);
        const produced = await applyBatchRecipe(source, recipe, t.pageNumbers.ofWord);

        if (heldBytes + produced.bytes.length > MAX_BATCH_OUTPUT_BYTES) {
          failures.push({ input: file.name, error: t.batch.outputLimit });
          for (const remaining of files.slice(index + 1)) {
            failures.push({ input: remaining.name, error: t.batch.outputLimit });
          }
          break;
        }

        // Read the real output once before it enters the ZIP. A malformed file
        // is isolated here instead of making the archive look successful.
        const verified = await openPdf(produced.bytes);
        const verifiedPages = verified.document.numPages;
        await verified.destroy().catch(() => {});

        const output = batchOutputName(file.name, index);
        const outputSha256 = await sha256Hex(produced.bytes);
        zip.file(output, produced.bytes);
        heldBytes += produced.bytes.length;
        successes.push({
          input: file.name,
          output,
          pages: verifiedPages,
          flattenedFields: produced.flattenedFields,
          signedInput: produced.signedInput,
          inputBytes: file.size,
          outputBytes: produced.bytes.length,
          inputSha256,
          outputSha256,
        });
      } catch (caught) {
        failures.push({ input: file.name, error: describeError(caught, t).detail });
      }
    }

    cancelled = controller.signal.aborted;

    try {
      const manifest = {
        schema: 'openpdf-batch-report/v1',
        generatedAt: new Date().toISOString(),
        locale,
        recipe,
        cancelled,
        successes,
        failures,
      };
      zip.file('openpdf-batch-report.json', `${JSON.stringify(manifest, null, 2)}\n`);
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      setResult({ zip: blob, successes, failures, cancelled });
    } catch (caught) {
      setError(describeError(caught, t));
    } finally {
      controllerRef.current = null;
      setProgress(null);
      setWorking(false);
    }
  };

  if (result) {
    const signed = result.successes.filter((row) => row.signedInput).length;
    return (
      <div className="min-h-screen bg-white">
        <Navbar />
        <main className="mx-auto max-w-5xl px-4 py-12">
          <div className="mb-8 flex items-start gap-4 border-b pb-8">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-fuchsia-50 text-fuchsia-700">
              <Archive className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{t.batch.reportTitle}</h1>
              <p className="mt-1 text-gray-600">
                {t.batch.reportSummary(result.successes.length, result.failures.length)}
              </p>
            </div>
          </div>

          {signed > 0 && (
            <p className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              {t.batch.signedInputs(signed)}
            </p>
          )}
          {result.cancelled && (
            <p className="mb-6 rounded-lg border border-gray-300 bg-gray-50 p-4 text-sm text-gray-800">
              {t.batch.cancelledNote}
            </p>
          )}

          <div className="divide-y rounded-lg border">
            {result.successes.map((row) => (
              <div key={row.output} className="flex items-start gap-3 p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{row.input}</p>
                  <p className="mt-1 text-xs text-gray-600">
                    {t.batch.success} · {t.batch.pages(row.pages)} · {formatBytes(row.outputBytes)}
                    {row.flattenedFields > 0 ? ` · ${t.batch.formsFixed(row.flattenedFields)}` : ''}
                  </p>
                </div>
              </div>
            ))}
            {result.failures.map((row, index) => (
              <div key={`${row.input}-${index}`} className="flex items-start gap-3 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{row.input}</p>
                  <p className="mt-1 text-xs text-red-700">{t.batch.failed} · {row.error}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => downloadBlob(result.zip, 'openpdf-batch.zip')}
              className="flex items-center gap-2 rounded-full bg-fuchsia-600 px-6 py-3 font-bold text-white hover:bg-fuchsia-700"
            >
              <Archive className="h-5 w-5" /> {t.batch.downloadZip}
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-full bg-gray-100 px-6 py-3 font-medium text-gray-700 hover:bg-gray-200"
            >
              {t.batch.startOver}
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-10 max-w-3xl">
          <h1 className="text-4xl font-bold text-gray-900">{t.batch.heading}</h1>
          <p className="mt-3 text-lg text-gray-600">{t.batch.intro}</p>
        </div>

        <ErrorNotice error={error} onDismiss={() => setError(null)} />

        {files.length === 0 ? (
          <FileDropzone
            inputId="batch-file-input"
            kind={PDF_FILES}
            multiple
            onFilesSelected={addFiles}
            className="cursor-pointer border-2 border-dashed border-gray-300 p-12 text-center transition-colors hover:border-fuchsia-500"
          >
            <div className="flex flex-col items-center gap-4">
              <Upload className="h-10 w-10 text-fuchsia-600" />
              <div>
                <p className="text-lg font-semibold text-gray-900">{t.batch.choose}</p>
                <p className="text-sm text-gray-600">{t.common.orDropIt}</p>
              </div>
            </div>
          </FileDropzone>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <section aria-labelledby="batch-files-heading">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 id="batch-files-heading" className="flex items-center gap-2 text-lg font-bold">
                  <FileStack className="h-5 w-5 text-fuchsia-600" /> {t.batch.fileCount(files.length)}
                </h2>
                <FileDropzone
                  inputId="batch-add-file-input"
                  kind={PDF_FILES}
                  multiple
                  disabled={working}
                  onFilesSelected={addFiles}
                  className="cursor-pointer"
                >
                  <span className="text-sm font-medium text-fuchsia-700">{t.batch.addFiles}</span>
                </FileDropzone>
              </div>
              <div className="divide-y border-y">
                {files.map((file, index) => (
                  <div key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">{file.name}</span>
                      <span className="text-xs text-gray-600">{formatBytes(file.size)}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`${t.batch.removeFile}: ${file.name}`}
                      disabled={working}
                      onClick={() => setFiles((current) => current.filter((_, at) => at !== index))}
                      className="rounded-lg p-2 text-gray-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-4 flex items-center gap-2 text-sm text-emerald-800">
                <ShieldCheck className="h-4 w-4 shrink-0" /> {t.batch.privacyNote}
              </p>
            </section>

            <aside aria-labelledby="batch-recipe-heading" className="border-l pl-6">
              <h2 id="batch-recipe-heading" className="mb-4 text-lg font-bold text-gray-900">
                {t.batch.recipe}
              </h2>
              <label className="block border-b pb-4">
                <span className="mb-2 block text-sm font-medium text-gray-900">{t.batch.rotate}</span>
                <select
                  value={recipe.rotate}
                  disabled={working}
                  onChange={(event) =>
                    setRecipe((current) => ({
                      ...current,
                      rotate: Number(event.target.value) as BatchRecipe['rotate'],
                    }))
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value={0}>{t.batch.rotateNone}</option>
                  <option value={90}>90°</option>
                  <option value={180}>180°</option>
                  <option value={270}>270°</option>
                </select>
              </label>

              <label className="block border-b py-4">
                <span className="mb-2 block text-sm font-medium text-gray-900">{t.batch.watermark}</span>
                <input
                  type="text"
                  value={recipe.watermark}
                  disabled={working}
                  placeholder={t.batch.watermarkPlaceholder}
                  onChange={(event) =>
                    setRecipe((current) => ({ ...current, watermark: event.target.value }))
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-fuchsia-500"
                />
              </label>

              <div className="divide-y border-b">
                <ToggleRow
                  checked={recipe.pageNumbers}
                  onChange={(pageNumbers) => setRecipe((current) => ({ ...current, pageNumbers }))}
                  label={t.batch.pageNumbers}
                />
                <ToggleRow
                  checked={recipe.flattenForms}
                  onChange={(flattenForms) => setRecipe((current) => ({ ...current, flattenForms }))}
                  label={t.batch.flattenForms}
                  note={t.batch.flattenNote}
                />
              </div>

              <p className="my-4 text-xs leading-relaxed text-amber-900">{t.batch.signedNote}</p>

              {working && progress ? (
                <div className="space-y-3" aria-live="polite">
                  <p className="flex items-start gap-2 text-sm text-gray-700">
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-fuchsia-600" />
                    {t.batch.working(progress.current, files.length, progress.name)}
                  </p>
                  <button
                    type="button"
                    onClick={() => controllerRef.current?.abort()}
                    className="w-full rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                  >
                    {t.batch.cancel}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void processBatch()}
                  disabled={!hasBatchAction(recipe)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-fuchsia-600 px-5 py-3 font-bold text-white hover:bg-fuchsia-700 disabled:bg-gray-300"
                >
                  <Play className="h-4 w-4" /> {t.batch.action}
                </button>
              )}
              {!working && !hasBatchAction(recipe) && (
                <p className="mt-2 text-xs text-gray-600">{t.batch.noActionBody}</p>
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
