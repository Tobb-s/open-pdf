'use client';

import { FileImage, ScanText, Loader2 } from 'lucide-react';
import { ColorRow, Field, NumberRow, Pills } from '@/components/StampControls';
import { useI18n } from '@/lib/i18n/context';
import { hexToRgb } from '@/lib/stamp';
import type {
  Metadata,
  MetadataPatch,
  NumberingSpec,
  ScriptState,
  WatermarkSpec,
} from '@/lib/studio/script';

/**
 * The half of the editor that acts on the document rather than on a page.
 *
 * Form fields, the title and author, a watermark and page numbers are all
 * settings that outlive any one page — a watermark applies to pages added
 * later, and the numbers are worked out from whatever order the pages end up
 * in. Keeping them here rather than among the drawing tools is what stops them
 * being mistaken for marks.
 */

export interface FormFieldInfo {
  name: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'radio';
  /** What the document itself says, before the reader changes anything. */
  original: string;
  options?: string[];
}

interface DocumentPanelProps {
  state: ScriptState;
  fields: readonly FormFieldInfo[];
  /** What the opened document already says, so a box is never blank by mistake. */
  originalMetadata: Metadata;
  onMetadata: (patch: MetadataPatch) => void;
  onField: (name: string, value: string) => void;
  onFlattenForms: (on: boolean) => void;
  onWatermark: (spec: WatermarkSpec | null) => void;
  onNumbering: (spec: NumberingSpec | null) => void;
  onInsertImages: (files: FileList) => void;
  onRunOcr: () => void;
  ocrBusy: boolean;
  ocrResult: number | null;
  disabled: boolean;
}

const DEFAULT_WATERMARK = (ofText: string): WatermarkSpec => ({
  text: ofText,
  font: { family: 'helvetica', bold: true, italic: false },
  size: 48,
  color: hexToRgb('#888888'),
  opacity: 0.25,
  angle: 45,
  anchor: 'center',
  margin: 36,
  pages: null,
});

const DEFAULT_NUMBERING = (ofWord: string): NumberingSpec => ({
  font: { family: 'helvetica', bold: false, italic: false },
  size: 11,
  color: hexToRgb('#333333'),
  anchor: 'bottom-center',
  margin: 36,
  startAt: 1,
  format: 'plain',
  ofWord,
  pages: null,
});

const toHex = (color: { r: number; g: number; b: number }) =>
  `#${[color.r, color.g, color.b]
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0'))
    .join('')}`;

export default function DocumentPanel({
  state,
  fields,
  originalMetadata,
  onMetadata,
  onField,
  onFlattenForms,
  onWatermark,
  onNumbering,
  onInsertImages,
  onRunOcr,
  ocrBusy,
  ocrResult,
  disabled,
}: DocumentPanelProps) {
  const { t } = useI18n();
  const watermark = state.watermark;
  const numbering = state.numbering;

  /** What a field holds right now: the reader's value, else the document's. */
  const valueOf = (info: FormFieldInfo) => state.fields[info.name] ?? info.original;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">{t.studio.metadata}</h3>
        {(
          [
            ['title', t.studio.metaTitle],
            ['author', t.studio.metaAuthor],
            ['language', t.studio.metaLanguage],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block space-y-1">
            <span className="text-xs text-gray-500">{label}</span>
            <input
              type="text"
              /* The document's own value when the reader has not changed it:
                 an empty box beside a document that has a title would invite
                 them to type over something they could not see. */
              value={state.metadata[key] ?? originalMetadata[key] ?? ''}
              disabled={disabled}
              onChange={(event) => {
                const typed = event.target.value;
                // Back to what the document says is not a change at all.
                onMetadata({ [key]: typed === (originalMetadata[key] ?? '') ? null : typed });
              }}
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-violet-400 disabled:bg-gray-50"
            />
          </label>
        ))}
      </section>

      <section className="space-y-3 border-t pt-5">
        <h3 className="text-sm font-semibold text-gray-900">{t.studio.fieldsSection}</h3>
        {fields.length === 0 ? (
          <p className="text-xs text-gray-500">{t.studio.noFields}</p>
        ) : (
          <>
            {fields.map((info) => (
              <label key={info.name} className="block space-y-1">
                <span className="block truncate text-xs text-gray-500">{info.name}</span>
                {info.type === 'checkbox' ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={valueOf(info) === 'true'}
                    disabled={disabled}
                    onClick={() => onField(info.name, valueOf(info) === 'true' ? 'false' : 'true')}
                    className={`rounded-xl px-3 py-1.5 text-sm font-medium ${
                      valueOf(info) === 'true'
                        ? 'bg-violet-600 text-white'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {valueOf(info) === 'true' ? '✓' : '—'}
                  </button>
                ) : info.options ? (
                  <select
                    value={valueOf(info)}
                    disabled={disabled}
                    onChange={(event) => onField(info.name, event.target.value)}
                    className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-violet-400"
                  >
                    <option value="">—</option>
                    {info.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={valueOf(info)}
                    disabled={disabled}
                    onChange={(event) => onField(info.name, event.target.value)}
                    className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-violet-400"
                  />
                )}
              </label>
            ))}
            <p className="text-xs text-gray-400">{t.studio.fieldsNote}</p>
            <button
              type="button"
              onClick={() => onFlattenForms(!state.flattenForms)}
              disabled={disabled}
              className={`w-full rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                state.flattenForms
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {state.flattenForms ? t.studio.flattenFormsOff : t.studio.flattenForms}
            </button>
            <p className="text-xs text-gray-400">{t.studio.flattenFormsNote}</p>
          </>
        )}
      </section>

      <section className="space-y-3 border-t pt-5">
        <h3 className="text-sm font-semibold text-gray-900">{t.studio.watermarkSection}</h3>
        <input
          type="text"
          value={watermark?.text ?? ''}
          placeholder={t.watermark.textPlaceholder}
          aria-label={t.studio.watermarkText}
          disabled={disabled}
          onChange={(event) => {
            const text = event.target.value;
            if (text.trim() === '') onWatermark(null);
            else onWatermark({ ...(watermark ?? DEFAULT_WATERMARK(text)), text });
          }}
          className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-violet-400"
        />
        {watermark && (
          <>
            <NumberRow
              label={t.stamp.size}
              value={watermark.size}
              min={8}
              max={200}
              onChange={(size) => onWatermark({ ...watermark, size })}
            />
            <ColorRow
              label={t.stamp.color}
              value={toHex(watermark.color)}
              onChange={(hex) => onWatermark({ ...watermark, color: hexToRgb(hex) })}
            />
            <button
              type="button"
              onClick={() => onWatermark(null)}
              className="w-full rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              {t.studio.watermarkOff}
            </button>
          </>
        )}
      </section>

      <section className="space-y-3 border-t pt-5">
        <h3 className="text-sm font-semibold text-gray-900">{t.studio.numbersSection}</h3>
        <Pills
          label={t.pageNumbers.format}
          value={numbering ? numbering.format : 'off'}
          options={[
            { value: 'off' as const, label: t.studio.numbersOff },
            { value: 'plain' as const, label: t.pageNumbers.formatPlain },
            { value: 'ofTotal' as const, label: t.pageNumbers.formatOfTotal },
          ]}
          onChange={(format) => {
            if (format === 'off') onNumbering(null);
            else
              onNumbering({ ...(numbering ?? DEFAULT_NUMBERING(t.pageNumbers.ofWord)), format });
          }}
        />
        {numbering && (
          <Field label={t.pageNumbers.startAt}>
            <NumberRow
              label={t.pageNumbers.startAt}
              value={numbering.startAt}
              min={0}
              max={99999}
              onChange={(startAt) => onNumbering({ ...numbering, startAt })}
            />
          </Field>
        )}
      </section>

      <section className="space-y-2 border-t pt-5">
        <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
          <FileImage className="h-4 w-4" />
          {t.studio.insertImages}
          <input
            type="file"
            accept="image/png,image/jpeg"
            multiple
            className="hidden"
            disabled={disabled}
            onChange={(event) => {
              if (event.target.files?.length) onInsertImages(event.target.files);
            }}
          />
        </label>
        <p className="text-xs text-gray-400">{t.studio.insertImagesHint}</p>
      </section>

      <section className="space-y-2 border-t pt-5">
        <button
          type="button"
          onClick={onRunOcr}
          disabled={disabled || ocrBusy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        >
          {ocrBusy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> {t.studio.ocrRunning}
            </>
          ) : (
            <>
              <ScanText className="h-4 w-4" /> {t.studio.runOcr}
            </>
          )}
        </button>
        {ocrResult !== null && (
          <p className="text-xs text-emerald-700">
            {ocrResult === 0 ? t.studio.ocrNone : t.studio.ocrDone(ocrResult)}
          </p>
        )}
        <p className="text-xs text-gray-400">{t.studio.ocrNote}</p>
      </section>
    </div>
  );
}
