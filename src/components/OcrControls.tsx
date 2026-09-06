'use client';
import { useI18n } from '@/lib/i18n/context';
import type { OcrOptions, QuarterTurn, OcrLanguage } from '@/lib/ocrAdvanced';

export default function OcrControls({
  value,
  onChange,
  disabled,
}: {
  value: OcrOptions;
  onChange: (value: OcrOptions) => void;
  disabled?: boolean;
}) {
  const { locale, t } = useI18n();
  const es = locale === 'es';
  return (
    <fieldset
      disabled={disabled}
      className="space-y-3 rounded-xl border border-gray-200 p-3 text-sm disabled:opacity-60"
    >
      <legend className="px-1 font-medium">
        {es ? 'OCR local avanzado' : 'Advanced local OCR'}
      </legend>
      <label className="block">
        {es ? 'Idioma del documento' : 'Document language'}
        <select
          className="mt-1 w-full rounded-lg border p-2"
          value={value.language}
          onChange={(e) => onChange({ ...value, language: e.target.value as OcrLanguage })}
        >
          {(['spa', 'eng', 'fra', 'deu', 'ita', 'por'] as const).map((lang) => (
            <option key={lang} value={lang}>
              {t.ocr.languages[lang]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        {es ? 'Calidad de lectura' : 'Recognition quality'}
        <select
          className="mt-1 w-full rounded-lg border p-2"
          value={value.mode}
          onChange={(e) => onChange({ ...value, mode: e.target.value as OcrOptions['mode'] })}
        >
          <option value="quick">{es ? 'Rápido · hasta 216 dpi' : 'Quick · up to 216 dpi'}</option>
          <option value="deep">
            {es
              ? 'Profundo · hasta 300 dpi + contraste alternativo'
              : 'Deep · up to 300 dpi + alternative contrast'}
          </option>
        </select>
      </label>
      <label className="block">
        {es ? 'Giro para leer (no gira el PDF)' : 'Reading rotation (PDF stays unchanged)'}
        <select
          className="mt-1 w-full rounded-lg border p-2"
          value={value.orientation}
          onChange={(e) =>
            onChange({
              ...value,
              orientation:
                e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as QuarterTurn),
            })
          }
        >
          <option value="auto">
            {es ? 'Automático · compara 4 orientaciones' : 'Automatic · compare 4 orientations'}
          </option>
          {[0, 90, 180, 270].map((turn) => (
            <option key={turn} value={turn}>
              {turn}°
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={value.skipText}
          onChange={(e) => onChange({ ...value, skipText: e.target.checked })}
        />
        {es ? 'Conservar el texto existente' : 'Preserve existing text'}
      </label>
      {!value.skipText && (
        <p className="text-amber-800">
          {es
            ? 'Puede duplicar texto existente. Usalo sólo si verificaste que la capa actual no sirve.'
            : 'May duplicate existing text. Use only if the current layer is unusable.'}
        </p>
      )}
      <p className="text-xs text-gray-500">
        {es
          ? 'Procesamiento en tu equipo. La confianza no garantiza exactitud: revisá nombres, cifras y fórmulas. Se omiten páginas con texto abundante; un escaneo con sólo un pie breve sí se lee.'
          : 'Processed on your device. Confidence does not guarantee accuracy: review names, numbers and formulas. Pages with substantial text are skipped; scans with only a short footer are still recognized.'}
      </p>
    </fieldset>
  );
}
