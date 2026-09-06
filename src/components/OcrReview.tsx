'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n/context';
import { wordsToText, type OcrPageResult } from '@/lib/ocrAdvanced';
import { losesCharacters, type OcrWord } from '@/lib/ocr';

export default function OcrReview({
  results,
  onChange,
  onReread,
  disabled,
}: {
  results: OcrPageResult[];
  onChange: (results: OcrPageResult[]) => void;
  onReread: (result: OcrPageResult, word: OcrWord) => Promise<string>;
  disabled?: boolean;
}) {
  const { locale } = useI18n();
  const es = locale === 'es';
  const [pageIndex, setPageIndex] = useState(0);
  const [onlyLow, setOnlyLow] = useState(true);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const result = results[Math.min(pageIndex, results.length - 1)];
  if (!result) return null;
  const words = result.words
    .map((word, index) => ({ word, index }))
    .filter(({ word }) => !onlyLow || word.confidence < 60);
  const word = selected === null ? null : result.words[selected];
  const change = (text: string) => {
    if (selected === null) return;
    const updated = result.words.map((item, i) => (i === selected ? { ...item, text } : item));
    onChange(
      results.map((item) =>
        item === result
          ? {
              ...item,
              words: updated,
              text: [wordsToText(updated), item.nativeText].filter(Boolean).join('\n'),
            }
          : item
      )
    );
  };
  return (
    <fieldset
      data-ocr-page={result.page}
      disabled={disabled || busy}
      className="my-4 space-y-3 rounded-xl border p-3 text-sm"
    >
      <legend className="px-1 font-medium">
        {es ? 'Revisar reconocimiento' : 'Review recognition'}
      </legend>
      <label>
        {es ? 'Página OCR' : 'OCR page'}
        <select
          aria-label={es ? 'Página OCR' : 'OCR page'}
          className="ml-2 rounded border p-1"
          value={pageIndex}
          onChange={(e) => {
            setPageIndex(Number(e.target.value));
            setOffset(0);
            setSelected(null);
            setCandidate(null);
          }}
        >
          {results.map((item, i) => (
            <option key={item.page} value={i}>
              {item.page}
            </option>
          ))}
        </select>
      </label>
      <p>
        {result.skipped
          ? es
            ? 'Texto existente conservado; no se agregó otra capa.'
            : 'Existing text preserved; no extra layer added.'
          : `${result.orientation}° · ${result.attempts} ${es ? 'pasadas' : 'passes'} · ${(result.milliseconds / 1000).toFixed(1)} s`}
      </p>
      {result.preview && (
        <div className="max-h-96 overflow-auto border bg-white">
          <div className="relative">
            {/* The preview is a local thumbnail, never the image used for recognition. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={result.preview}
              alt={es ? 'Vista previa OCR orientada para lectura' : 'Upright OCR preview'}
              className="w-full"
            />
            {word && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute border-2 border-orange-500 bg-orange-300/30"
                style={{
                  left: `${(word.left / result.width) * 100}%`,
                  top: `${(word.top / result.height) * 100}%`,
                  width: `${((word.right - word.left) / result.width) * 100}%`,
                  height: `${((word.bottom - word.top) / result.height) * 100}%`,
                }}
              />
            )}
          </div>
        </div>
      )}
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={onlyLow}
          onChange={(e) => {
            setOnlyLow(e.target.checked);
            setOffset(0);
          }}
        />
        {es ? 'Sólo palabras dudosas (<60)' : 'Only uncertain words (<60)'}
      </label>
      <p>
        {words.length} {es ? 'palabras para revisar' : 'words to review'}
      </p>
      {result.words.some((word) => losesCharacters(word.text)) && (
        <p className="text-amber-800">
          {es
            ? 'Algunos símbolos no pueden incluirse en la capa PDF con esta fuente. El texto plano los conserva; revisá especialmente las fórmulas.'
            : 'Some symbols cannot be included in the PDF layer with this font. Plain text retains them; review formulas carefully.'}
        </p>
      )}
      <div className="flex max-h-32 flex-wrap gap-1 overflow-auto">
        {words.slice(offset, offset + 50).map(({ word: item, index }) => (
          <button
            type="button"
            className={`rounded border px-2 py-1 ${selected === index ? 'bg-orange-100' : ''}`}
            key={index}
            onClick={() => {
              setSelected(index);
              setCandidate(null);
              setError('');
            }}
          >
            {item.text || '∅'} <span className="text-gray-500">{Math.round(item.confidence)}</span>
          </button>
        ))}
      </div>
      {words.length > 50 && (
        <div className="flex gap-3">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            ←
          </button>
          <span>
            {offset + 1}–{Math.min(offset + 50, words.length)}
          </span>
          <button
            type="button"
            disabled={offset + 50 >= words.length}
            onClick={() => setOffset(offset + 50)}
          >
            →
          </button>
        </div>
      )}
      {word && (
        <div className="space-y-2">
          <div
            aria-label={es ? 'Recorte original ampliado' : 'Enlarged original crop'}
            className="relative overflow-hidden border bg-white"
            style={{
              aspectRatio: Math.max(1, (word.right - word.left + 8) / (word.bottom - word.top + 8)),
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              src={result.preview}
              className="absolute max-w-none"
              style={{
                width: `${(result.width / (word.right - word.left + 8)) * 100}%`,
                left: `${(-(word.left - 4) / (word.right - word.left + 8)) * 100}%`,
                top: `${(-(word.top - 4) / (word.bottom - word.top + 8)) * 100}%`,
              }}
            />
          </div>
          <label className="block">
            {es
              ? 'Corregir palabra OCR (no modifica la imagen)'
              : 'Correct OCR word (image is unchanged)'}
            <input
              className="mt-1 w-full rounded border p-2"
              value={word.text}
              maxLength={200}
              onChange={(e) => change(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded border px-3 py-2"
            onClick={async () => {
              setBusy(true);
              setError('');
              setCandidate(null);
              try {
                setCandidate(await onReread(result, word));
              } catch {
                setError(
                  es
                    ? 'No se pudo releer. Podés corregir la palabra manualmente.'
                    : 'Could not reread. You can still correct the word manually.'
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {es ? 'Releer este recorte ampliado' : 'Reread this enlarged crop'}
          </button>
          {candidate !== null && (
            <p>
              {es ? 'Alternativa:' : 'Alternative:'} {candidate || '∅'}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  change(candidate);
                  setCandidate(null);
                }}
              >
                {es ? 'Usar alternativa' : 'Use alternative'}
              </button>
            </p>
          )}
        </div>
      )}
      {busy && <p role="status">{es ? 'Releyendo el recorte…' : 'Rereading crop…'}</p>}
      {error && <p role="alert">{error}</p>}
      <p className="text-xs text-gray-500">
        {es
          ? 'Las correcciones se aplican al texto reconocido, no al contenido visible. No se corrigen nombres ni números automáticamente.'
          : 'Corrections affect recognized text, not visible content. Names and numbers are never automatically spell-corrected.'}
      </p>
    </fieldset>
  );
}
