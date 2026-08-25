'use client';

import { useI18n } from '@/lib/i18n/context';
import { ANCHORS, type Anchor } from '@/lib/geometry';
import { FONT_FAMILIES, type FontChoice, type FontFamily } from '@/lib/stamp';

/**
 * The controls the watermark and the page-number tools share.
 *
 * They are one component set rather than two copies because the two tools ask
 * the same questions — where, how big, which pages — and a divergence between
 * them would be a bug the reader notices before we do.
 */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-gray-900">{label}</span>
        {hint && <span className="text-xs text-gray-600">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const PILL = 'rounded-xl px-3 py-2 text-sm font-medium transition-colors';
const PILL_ON = 'bg-blue-600 text-white';
const PILL_OFF = 'bg-gray-100 text-gray-700 hover:bg-gray-200';

export function Pills<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`${PILL} ${value === option.value ? PILL_ON : PILL_OFF}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The nine positions, laid out as the nine positions. */
export function AnchorPicker({
  value,
  onChange,
}: {
  value: Anchor;
  onChange: (anchor: Anchor) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="radiogroup"
      aria-label={t.stamp.position}
      className="grid w-fit grid-cols-3 gap-1.5 rounded-2xl border bg-gray-50 p-2"
    >
      {ANCHORS.map((anchor) => (
        <button
          key={anchor}
          type="button"
          role="radio"
          aria-checked={value === anchor}
          aria-label={t.stamp.anchors[anchor]}
          title={t.stamp.anchors[anchor]}
          onClick={() => onChange(anchor)}
          className={`h-9 w-12 rounded-lg border transition-colors ${
            value === anchor
              ? 'border-blue-600 bg-blue-600'
              : 'border-gray-200 bg-white hover:border-blue-300'
          }`}
        >
          <span
            className={`mx-auto block h-1.5 w-1.5 rounded-full ${
              value === anchor ? 'bg-white' : 'bg-gray-300'
            }`}
          />
        </button>
      ))}
    </div>
  );
}

export function FontPicker({
  value,
  onChange,
}: {
  value: FontChoice;
  onChange: (font: FontChoice) => void;
}) {
  const { t } = useI18n();
  const names: Record<FontFamily, string> = {
    helvetica: t.stamp.fontHelvetica,
    times: t.stamp.fontTimes,
    courier: t.stamp.fontCourier,
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pills
        label={t.stamp.typeface}
        value={value.family}
        options={FONT_FAMILIES.map((family) => ({ value: family, label: names[family] }))}
        onChange={(family) => onChange({ ...value, family })}
      />
      <span className="mx-1 h-6 w-px bg-gray-200" aria-hidden />
      <button
        type="button"
        aria-pressed={value.bold}
        onClick={() => onChange({ ...value, bold: !value.bold })}
        className={`${PILL} font-bold ${value.bold ? PILL_ON : PILL_OFF}`}
      >
        {t.stamp.bold}
      </button>
      <button
        type="button"
        aria-pressed={value.italic}
        onClick={() => onChange({ ...value, italic: !value.italic })}
        className={`${PILL} italic ${value.italic ? PILL_ON : PILL_OFF}`}
      >
        {t.stamp.italic}
      </button>
    </div>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} hint={format(value)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-blue-600"
      />
    </Field>
  );
}

export function NumberRow({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(Math.max(next, min), max));
        }}
        className="w-28 rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-400"
      />
    </Field>
  );
}

export interface PageScope {
  mode: 'all' | 'some';
  range: string;
}

export function PageScopePicker({
  scope,
  onChange,
  pages,
  invalid,
  summary,
}: {
  scope: PageScope;
  onChange: (scope: PageScope) => void;
  pages: number[];
  invalid: string[];
  summary: string;
}) {
  const { t } = useI18n();

  return (
    <Field label={t.stamp.whichPages}>
      <Pills
        label={t.stamp.whichPages}
        value={scope.mode}
        options={[
          { value: 'all' as const, label: t.stamp.allPages },
          { value: 'some' as const, label: t.stamp.somePages },
        ]}
        onChange={(mode) => onChange({ ...scope, mode })}
      />

      {scope.mode === 'some' && (
        <div className="space-y-2 pt-2">
          <input
            type="text"
            inputMode="numeric"
            value={scope.range}
            placeholder={t.stamp.rangePlaceholder}
            aria-label={t.stamp.whichPages}
            onChange={(event) => onChange({ ...scope, range: event.target.value })}
            className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-400"
          />
          <p className="text-xs text-gray-600">{t.stamp.rangeHelp}</p>

          {invalid.length > 0 && (
            <p className="text-xs font-medium text-amber-700">
              {t.stamp.rangeInvalid(invalid.join(', '))}
            </p>
          )}
          {pages.length === 0 ? (
            <p className="text-xs font-medium text-amber-700">{t.stamp.rangeEmpty}</p>
          ) : (
            <p className="text-xs text-gray-500">{t.stamp.rangeChosen(pages.length, summary)}</p>
          )}
        </div>
      )}
    </Field>
  );
}

export function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <input
        type="color"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-20 cursor-pointer rounded-xl border bg-white p-1"
      />
    </Field>
  );
}
