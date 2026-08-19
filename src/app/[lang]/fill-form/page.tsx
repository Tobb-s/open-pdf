'use client';

import { useRef, useState } from 'react';
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import Navbar from '@/components/Navbar';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import { AlertTriangle, Download, FileText, Loader2, Upload, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { describeError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob } from '@/lib/files';
import { assertFileSize } from '@/lib/limits';

interface FormField {
  name: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'radio';
  value: string;
  options?: string[];
}

interface FillResult {
  blob: Blob;
  filled: number;
  skipped: string[];
}

/** `applicant_first<name>` → `applicant first name`, for a readable label. */
function humanizeFieldName(name: string): string {
  return name.replace(/[<>]/g, '').replace(/[_.]/g, ' ').trim();
}

export default function FillFormPage() {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<FillResult | null>(null);
  const [error, setError] = useState<ToolError | null>(null);
  const bytesRef = useRef<Uint8Array | null>(null);

  const reset = () => {
    bytesRef.current = null;
    setFile(null);
    setFields([]);
    setResult(null);
    setError(null);
  };

  const selectFile = async (selected: File) => {
    reset();
    setFile(selected);
    setIsLoading(true);

    try {
      assertFileSize(selected, t);
      const bytes = new Uint8Array(await selected.arrayBuffer());
      bytesRef.current = bytes;

      const document_ = await PDFDocument.load(bytes);
      const detected: FormField[] = [];

      for (const field of document_.getForm().getFields()) {
        const name = field.getName();

        if (field instanceof PDFTextField) {
          detected.push({ name, type: 'text', value: field.getText() ?? '' });
        } else if (field instanceof PDFCheckBox) {
          detected.push({ name, type: 'checkbox', value: field.isChecked() ? 'true' : 'false' });
        } else if (field instanceof PDFDropdown) {
          detected.push({
            name,
            type: 'dropdown',
            value: field.getSelected()[0] ?? '',
            options: field.getOptions(),
          });
        } else if (field instanceof PDFRadioGroup) {
          detected.push({
            name,
            type: 'radio',
            value: field.getSelected() ?? '',
            options: field.getOptions(),
          });
        }
      }

      setFields(detected);
    } catch (caught) {
      setError(describeError(caught, t));
      setFile(null);
    } finally {
      setIsLoading(false);
    }
  };

  const updateField = (index: number, value: string) => {
    setFields((previous) =>
      previous.map((field, position) => (position === index ? { ...field, value } : field))
    );
  };

  const fillForm = async () => {
    const bytes = bytesRef.current;
    if (!bytes) return;

    setIsProcessing(true);
    setError(null);

    try {
      const document_ = await PDFDocument.load(bytes);
      const form = document_.getForm();

      // Every field that cannot be written is collected rather than swallowed. The
      // old empty `catch {}` dropped values the reader had typed and still reported
      // success.
      const skipped: string[] = [];
      let filled = 0;

      for (const field of fields) {
        try {
          if (field.type === 'text') {
            form.getTextField(field.name).setText(field.value);
          } else if (field.type === 'checkbox') {
            const checkbox = form.getCheckBox(field.name);
            if (field.value === 'true') checkbox.check();
            else checkbox.uncheck();
          } else if (field.type === 'dropdown') {
            const dropdown = form.getDropdown(field.name);
            if (field.value === '') dropdown.clear();
            else dropdown.select(field.value);
          } else {
            const group = form.getRadioGroup(field.name);
            if (field.value === '') group.clear();
            else group.select(field.value);
          }
          filled += 1;
        } catch {
          skipped.push(humanizeFieldName(field.name));
        }
      }

      const saved = (await document_.save()).slice();
      setResult({
        blob: new Blob([saved], { type: 'application/pdf' }),
        filled,
        skipped,
      });
    } catch (caught) {
      setError(describeError(caught, t));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-12 text-center">
          <h1 className="mb-4 text-4xl font-bold text-gray-900">{t.fillForm.heading}</h1>
          <p className="text-gray-600">
            {t.fillForm.intro}
          </p>
        </div>

        {!file ? (
          <div className="space-y-6">
            <FileDropzone
              inputId="fill-form-file-input"
              kind={PDF_FILES}
              onFilesSelected={([selected]) => void selectFile(selected)}
              className="cursor-pointer rounded-3xl border-2 border-dashed border-gray-300 bg-white p-12 text-center transition-all hover:border-blue-400"
            >
              <div className="flex flex-col items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <Upload className="h-8 w-8" />
                </div>
                <p className="text-lg font-semibold">{t.fillForm.choose}</p>
                <p className="text-sm text-gray-500">{t.fillForm.chooseNote}</p>
              </div>
            </FileDropzone>
            <ErrorNotice error={error} onDismiss={() => setError(null)} />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between rounded-2xl border bg-white p-4">
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-6 w-6 shrink-0 text-blue-500" />
                <span className="truncate font-medium">{file.name}</span>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">
                  {fields.length} {fields.length === 1 ? t.common.field : t.common.fields}
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

            {isLoading ? (
              <div className="flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <span className="ml-3 text-gray-600">{t.fillForm.looking}</span>
              </div>
            ) : fields.length === 0 ? (
              <div className="rounded-3xl border bg-white p-12 text-center">
                <p className="text-gray-700">{t.fillForm.noFieldsTitle}</p>
                <p className="mt-2 text-sm text-gray-500">{t.fillForm.noFieldsBody}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-3xl border bg-white p-6 shadow-sm">
                  <h2 className="mb-6 font-semibold text-gray-700">{t.fillForm.sectionTitle}</h2>
                  <div className="space-y-5">
                    {fields.map((field, index) => (
                      <div key={`${field.name}-${index}`}>
                        <label
                          className="mb-1.5 block text-sm font-medium capitalize text-gray-600"
                          htmlFor={`field-${index}`}
                        >
                          {humanizeFieldName(field.name)}
                          <span className="ml-2 text-xs text-gray-400">({field.type})</span>
                        </label>

                        {field.type === 'text' && (
                          <input
                            id={`field-${index}`}
                            type="text"
                            value={field.value}
                            onChange={(event) => updateField(index, event.target.value)}
                            className="w-full rounded-xl border px-4 py-2.5 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-500"
                          />
                        )}

                        {field.type === 'checkbox' && (
                          <button
                            id={`field-${index}`}
                            type="button"
                            aria-pressed={field.value === 'true'}
                            onClick={() =>
                              updateField(index, field.value === 'true' ? 'false' : 'true')
                            }
                            className={`rounded-xl border px-6 py-2 text-sm font-medium transition-all ${
                              field.value === 'true'
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-gray-300 bg-white text-gray-600 hover:border-blue-400'
                            }`}
                          >
                            {field.value === 'true' ? t.fillForm.checked : t.fillForm.unchecked}
                          </button>
                        )}

                        {field.type === 'dropdown' && (
                          <select
                            id={`field-${index}`}
                            value={field.value}
                            onChange={(event) => updateField(index, event.target.value)}
                            className="w-full rounded-xl border bg-white px-4 py-2.5 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">{t.fillForm.leaveEmpty}</option>
                            {field.options?.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        )}

                        {field.type === 'radio' && (
                          <div className="flex flex-wrap gap-3">
                            {field.options?.map((option) => (
                              <button
                                key={option}
                                type="button"
                                aria-pressed={field.value === option}
                                onClick={() => updateField(index, option)}
                                className={`rounded-xl border px-4 py-2 text-sm transition-all ${
                                  field.value === option
                                    ? 'border-blue-600 bg-blue-600 text-white'
                                    : 'border-gray-300 bg-white text-gray-600 hover:border-blue-400'
                                }`}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={fillForm}
                    disabled={isProcessing}
                    className="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" /> {t.fillForm.working}
                      </>
                    ) : (
                      t.fillForm.action
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {result && file && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
            <div className="max-w-md rounded-3xl border bg-white p-10 text-center shadow-xl">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-600">
                <FileText className="h-10 w-10" />
              </div>
              <h2 className="mb-2 text-2xl font-bold">
                {t.fillForm.doneTitle(result.filled, fields.length)}
              </h2>

              {result.skipped.length > 0 ? (
                <div className="mb-6 mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <p className="text-sm text-amber-900">
                    {t.fillForm.skippedNote(result.skipped.join(', '))}
                  </p>
                </div>
              ) : (
                <p className="mb-8 text-gray-600">{t.fillForm.doneBody}</p>
              )}

              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <button
                  type="button"
                  onClick={() => downloadBlob(result.blob, derivedFileName(file.name, '_filled.pdf'))}
                  className="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-4 text-lg font-bold text-white hover:bg-blue-700"
                >
                  <Download className="h-5 w-5" /> {t.common.download}
                </button>
                <button
                  type="button"
                  onClick={() => setResult(null)}
                  className="rounded-full bg-gray-100 px-8 py-4 text-lg font-bold text-gray-700 hover:bg-gray-200"
                >
                  {t.fillForm.keepEditing}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
