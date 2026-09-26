'use client';
import { useState } from 'react';
import Image from 'next/image';
import type { TranslationPage, TranslationBlock } from '@/lib/translation/layout';
import { prepareTranslationRegion, rereadTranslationRegion } from '@/lib/translation/region';
import { TranslationError, type TranslationProvider } from '@/lib/translation/contracts';
import { validateRegionResult, type RegionReviewResult } from '@/lib/translation/review-contract';
import { translationCopy } from '@/lib/translation/copy';

interface Reading { image: string; width: number; height: number; sourceText: string;
  candidates: { text: string; confidence: number; mode: string }[]; vision?: RegionReviewResult }
export default function TranslationRegionReview({ source, page, block, busy, provider, model, apiKey, locale, run, apply }: {
  source: Uint8Array; page: TranslationPage; block: TranslationBlock; busy: boolean;
  provider: TranslationProvider; model: string; apiKey: string; locale: 'es' | 'en';
  run: (work: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  apply: (text: string) => void;
}) {
  const c = translationCopy[locale];
  const [reading, setReading] = useState<Reading>();
  const [approval, setApproval] = useState<{ reading: Reading; model: string; apiKey: string }>();
  const [proposal, setProposal] = useState('');
  const current = reading?.sourceText === block.source ? reading : undefined;
  const consent = !!current && approval?.reading === current && approval.model === model && approval.apiKey === apiKey;
  const enabled = !busy && block.included;
  function prepare() {
    void run(async signal => {
      setReading(undefined); setProposal(''); setApproval(undefined);
      const crop = await prepareTranslationRegion(source, page, block, signal);
      const base = { ...crop, sourceText: block.source, candidates: [] };
      setReading(base);
      const candidates = await rereadTranslationRegion(crop.image, signal);
      signal.throwIfAborted();
      setReading({ ...base, candidates });
    });
  }
  function vision() {
    if (!current || !consent || provider !== 'openai') return;
    void run(async signal => {
      // Each click sends exactly one crop. No automatic retry or translated/context text.
      const response = await fetch('/api/translation-review', { method: 'POST', cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(110_000)]),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({ model: model.trim(), image: current.image, sourceText: current.sourceText, consent: true }),
      });
      let data;
      try { data = await response.json(); } catch { throw new TranslationError('invalid_response'); }
      if (!response.ok) throw new TranslationError(typeof data?.error === 'string' ? data.error : 'review_failed');
      const result = validateRegionResult(data); signal.throwIfAborted();
      setReading({ ...current, vision: result });
    });
  }
  return <details className="rounded-lg border border-blue-200 p-3 text-sm">
    <summary className="cursor-pointer font-medium">{c.regionTitle}</summary>
    <p className="my-2 text-gray-600">{c.regionHelp}</p>
    <button type="button" disabled={!enabled} className="rounded border px-3 py-2 disabled:opacity-40"
      onClick={prepare} aria-label={`${c.regionOcr} ${block.id}`}>{c.regionOcr}</button>
    {current && <div className="mt-3 space-y-3">
      <Image src={current.image} alt={`${c.regionCrop} ${block.id}`} width={current.width} height={current.height}
        unoptimized className="h-auto max-h-80 w-auto max-w-full border object-contain" />
      <p>{c.regionCropWarning}</p>
      {current.candidates.length === 0 && <p>{c.regionEmpty}</p>}
      {current.candidates.map(candidate => <div key={candidate.mode} className="rounded border p-2">
        <p>OCR PSM {candidate.mode} · {Math.round(candidate.confidence)}/100</p>
        <p className="whitespace-pre-wrap">{candidate.text}</p>
        <button type="button" disabled={!enabled} className="mt-2 rounded border px-2 py-1"
          onClick={() => setProposal(candidate.text)}>{c.regionChoose} OCR {candidate.mode}</button>
      </div>)}
      <p className="text-amber-800">{c.regionVisionHelp}</p>
      <label className="flex gap-2"><input type="checkbox" checked={consent} disabled={!enabled || provider !== 'openai'}
        onChange={e => setApproval(e.target.checked ? { reading: current, model, apiKey } : undefined)} />{c.regionConsent}</label>
      <button type="button" disabled={!enabled || provider !== 'openai' || !consent || !apiKey.trim() || !model.trim()}
        className="rounded border px-3 py-2 disabled:opacity-40" aria-label={`${c.regionVision} ${block.id}`}
        onClick={vision}>{c.regionVision}</button>
      {current.vision && <div className="rounded border p-2">
        <p>{c.regionVisionResult}{current.vision.uncertain ? ` · ${c.regionUncertain}` : ''}</p>
        <p className="whitespace-pre-wrap">{current.vision.text}</p>
        <button type="button" disabled={!enabled} className="mt-2 rounded border px-2 py-1"
          onClick={() => setProposal(current.vision!.text)}>{c.regionChoose} IA</button>
      </div>}
      <label className="block">{c.regionProposal}<textarea aria-label={`${c.regionProposal} ${block.id}`}
        className="mt-1 block w-full rounded border p-2" rows={4} maxLength={12_000} value={proposal}
        onChange={e => setProposal(e.target.value)} /></label>
      <p>{c.regionApplyHelp}</p>
      <button type="button" disabled={!enabled || !proposal.trim()} className="rounded border px-3 py-2 disabled:opacity-40"
        onClick={() => { void run(async signal => {
          signal.throwIfAborted();
          const checked = validateRegionResult({ text: proposal, uncertain: true });
          apply(checked.text); setReading(undefined); setApproval(undefined); setProposal('');
        }); }}>
        {c.regionApply}
      </button>
    </div>}
  </details>;
}
