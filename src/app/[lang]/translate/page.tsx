'use client';
import { useEffect, useRef, useState } from 'react';
import Navbar from '@/components/Navbar';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import TranslationPreview from '@/components/TranslationPreview';
import { useI18n } from '@/lib/i18n/context';
import { downloadBlob, derivedFileName } from '@/lib/files';
import { batches, MAX_SEGMENTS, TranslationError, validateTranslationResult, type TranslationProvider } from '@/lib/translation/contracts';
import { pendingSegments, type TranslationBlock, type TranslationPage } from '@/lib/translation/layout';
import { translationCopy } from '@/lib/translation/copy';
import { analyzeTranslation, checkTranslationLayout, exportTranslation, type LayoutIssue } from '@/lib/translation/document';

const field = 'block w-full rounded-lg border border-gray-300 bg-white p-2 text-sm disabled:opacity-50';
const button = 'rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40';
export default function TranslatePage() {
  const { locale, t } = useI18n(), c = translationCopy[locale];
  const [file, setFile] = useState<File>();
  const [source, setSource] = useState<Uint8Array>();
  const [pages, setPages] = useState<TranslationPage[]>([]);
  const [complete, setComplete] = useState(false), [forceOcr, setForceOcr] = useState(false);
  const [provider, setProvider] = useState<TranslationProvider>('openai');
  const [model, setModel] = useState('gpt-4.1-mini'), [baseUrl, setBaseUrl] = useState('https://openrouter.ai/api/v1');
  const [key, setKey] = useState(''), [glossary, setGlossary] = useState(''), [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [error, setError] = useState('');
  const [pageIndex, setPageIndex] = useState(0), [issues, setIssues] = useState<LayoutIssue[]>([]);
  const [output, setOutput] = useState<Uint8Array>();
  const [batchLimit, setBatchLimit] = useState(MAX_SEGMENTS);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const current = pages[pageIndex], pending = pendingSegments(pages).length;
  const invalidate = () => { setOutput(undefined); setIssues([]); };
  function updateBlock(id: string, patch: Partial<TranslationBlock>) {
    invalidate();
    setPages(old => old.map(p => ({ ...p, blocks: p.blocks.map(b => b.id === id ? { ...b, ...patch } : b) })));
  }
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (controller.current) return;
    const next = new AbortController(); controller.current = next;
    setBusy(true); setError('');
    try { await work(next.signal); }
    catch (e) {
      setError(next.signal.aborted ? c.errors.cancelled_or_timeout
        : c.errors[e instanceof TranslationError ? e.code : 'translation_failed'] ?? c.errors.translation_failed);
    } finally { controller.current = null; setBusy(false); setProgress(''); }
  }
  function analyze() {
    if (!file) return;
    void run(async signal => {
      invalidate(); setPages([]); setComplete(false); setPageIndex(0); setBatchLimit(MAX_SEGMENTS);
      if (file.size > 50 * 1024 * 1024) throw new TranslationError('file_too_large');
      const bytes = new Uint8Array(await file.arrayBuffer()); setSource(bytes);
      await analyzeTranslation(bytes, { forceOcr, signal,
        progress: (n, total) => setProgress(`${c.analyzeProgress} ${n}/${total}`),
        checkpoint: page => setPages(old => [...old, page]),
      });
      setComplete(true);
    });
  }
  function translate() {
    void run(async signal => {
      invalidate();
      const groups = batches(pendingSegments(pages), batchLimit);
      for (let i = 0; i < groups.length; i++) {
        signal.throwIfAborted(); setProgress(`${c.translateProgress} ${i + 1}/${groups.length}`);
        try {
          const response = await fetch('/api/translate', { method: 'POST', cache: 'no-store',
            signal: AbortSignal.any([signal, AbortSignal.timeout(110_000)]),
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
            body: JSON.stringify({ provider, model: model.trim(), baseUrl: provider === 'compatible' ? baseUrl.trim() : undefined,
              glossary, consent, segments: groups[i] }),
          });
          let data;
          try { data = await response.json(); }
          catch { throw new TranslationError('invalid_response'); }
          if (!response.ok) throw new TranslationError(typeof data?.error === 'string' ? data.error : 'translation_failed');
          // Recompute missing IDs locally; never trust provider-supplied completion metadata.
          const result = validateTranslationResult(data, groups[i]);
          const translations = new Map(result.translations.map(s => [s.id, s.text]));
          signal.throwIfAborted();
          setPages(old => old.map(p => ({ ...p, blocks: p.blocks.map(b => translations.has(b.id) && !b.translated.trim()
            ? { ...b, translated: translations.get(b.id)! } : b) })));
          if (result.missingIds.length) throw new TranslationError('partial_response');
        } catch (e) {
          if (!signal.aborted && e instanceof TranslationError &&
              ['invalid_response', 'partial_response'].includes(e.code)) {
            setBatchLimit(old => Math.min(old, Math.max(1, Math.floor(groups[i].length / 2))));
          }
          throw e;
        }
      }
    });
  }
  function preview() {
    if (!source) return;
    void run(async signal => {
      setOutput(undefined);
      const found = await checkTranslationLayout(pages); setIssues(found);
      if (found.length) { setPageIndex(found[0].page - 1); throw new TranslationError('layout_issues'); }
      const result = await exportTranslation(source, pages, signal, n => setProgress(`${c.exportProgress} ${n}/${pages.length}`));
      setOutput(result);
    });
  }
  return <><Navbar /><main className="mx-auto max-w-6xl space-y-6 px-4 py-10">
    <header><h1 className="text-3xl font-semibold">{c.title}</h1><p className="mt-2 text-gray-600">{c.intro}</p></header>
    <p className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm">{c.privacy}</p>
    <details className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm" open>
      <summary className="font-medium">{c.reviewRequired}</summary><p className="mt-2">{c.limits}</p>
    </details>
    <section className="space-y-3 rounded-xl border p-4">
      <FileDropzone inputId="translate-file-input" kind={PDF_FILES} disabled={busy} className="rounded-lg border-2 border-dashed p-6 text-center" onFilesSelected={files => {
        setFile(files[0]); setSource(undefined); setPages([]); setComplete(false); setError(''); setConsent(false); setBatchLimit(MAX_SEGMENTS); invalidate();
      }}>{file?.name ?? t.common.choosePdf}</FileDropzone>
      <p className="text-sm text-gray-600">{c.analyzeHelp}</p>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={forceOcr} disabled={busy} onChange={e => setForceOcr(e.target.checked)} />{c.force}</label>
      <button className={button} disabled={!file || busy} onClick={analyze}>{c.analyze}</button>
    </section>
    <fieldset disabled={busy} className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
      <label className="text-sm">{c.provider}<select className={field} value={provider} onChange={e => {
        const value = e.target.value as TranslationProvider; setProvider(value); setKey(''); setConsent(false);
        setModel(value === 'openai' ? 'gpt-4.1-mini' : value === 'gemini' ? 'gemini-2.5-flash' : '');
      }}><option value="openai">OpenAI</option><option value="gemini">Gemini</option><option value="compatible">OpenAI-compatible / OpenRouter</option></select></label>
      <label className="text-sm">{c.model}<input className={field} value={model} onChange={e => { setModel(e.target.value); setConsent(false); }} maxLength={120} /></label>
      {provider === 'compatible' && <label className="text-sm sm:col-span-2">{c.endpoint}<input className={field} value={baseUrl} onChange={e => { setBaseUrl(e.target.value); setConsent(false); setKey(''); }} /><span>{c.custom}</span></label>}
      <label className="text-sm">{c.key}<input className={field} type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} maxLength={2048} /></label>
      <button className="self-end rounded-lg border p-2 text-sm" onClick={() => { setKey(''); setConsent(false); }}>{c.clear}</button>
      <label className="text-sm sm:col-span-2">{c.glossary}<textarea className={field} value={glossary} maxLength={3000} onChange={e => { setGlossary(e.target.value); setConsent(false); }} /></label>
      <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />{c.consent}</label>
    </fieldset>
    <div className="flex flex-wrap items-center gap-3">
      <button className={button} disabled={busy || !complete || !pending || !consent || !key.trim() || !model.trim()} onClick={translate}>{c.translate}</button>
      <button className={button} disabled={busy || !complete || pending > 0 || !pages.some(p => p.blocks.some(b => b.included))} onClick={preview}>{c.preview}</button>
      {output && <button className={button} onClick={() => downloadBlob(new Blob([output.slice().buffer as ArrayBuffer], { type: 'application/pdf' }), derivedFileName(file!.name, '_es-AR.pdf'))}>{c.download}</button>}
      {busy && <button className="rounded-lg border px-4 py-2" onClick={() => controller.current?.abort()}>{c.cancel}</button>}
    </div>
    <p role="status" className="text-sm">{progress || (pages.length ? `${pending} ${c.pending}` : '')}</p>
    {batchLimit < MAX_SEGMENTS && <p className="text-sm text-amber-800">{c.recovery} {batchLimit} {c.recoveryLimit}</p>}
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm">{error}<p>{c.kept}</p></div>}
    {current && <section className="space-y-4">
      <div className="flex gap-3"><h2 className="text-xl font-medium">{c.review}</h2>
        <label>{c.page} <select aria-label={c.page} value={pageIndex} onChange={e => setPageIndex(Number(e.target.value))}>
          {pages.map((p, i) => <option value={i} key={p.number}>{p.number} ({p.method.toUpperCase()})</option>)}
        </select></label></div>
      <p className="text-sm text-amber-800">{c.excluded}</p>
      {current.warnings.length > 0 && <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">{c.warnings}: {current.warnings.map(w => c[w as 'no_text' | 'rotated_text' | 'outside_page']).join(' ')}</div>}
      {source && <div className="grid gap-4 md:grid-cols-2"><TranslationPreview bytes={source} page={current.number} label={c.original} />
        {output && <TranslationPreview bytes={output} page={current.number} label={c.result} />}</div>}
      {current.blocks.map(b => <fieldset key={b.id} disabled={busy} className="space-y-2 rounded-xl border p-4">
        <label className="flex gap-2 text-sm font-medium"><input type="checkbox" checked={b.included} onChange={e => updateBlock(b.id, { included: e.target.checked })} />{b.id} · {c.include}</label>
        <p className="text-xs text-gray-500">{b.font} · {b.size.toFixed(1)} pt{b.confidence !== undefined ? ` · OCR ${Math.round(b.confidence)}/100` : ''}</p>
        {b.confidence !== undefined && b.confidence < 60 && <p className="text-sm text-amber-800">{c.low}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">{c.source}<textarea aria-label={`${c.source} ${b.id}`} rows={4} className={field} value={b.source} maxLength={12_000} onChange={e => updateBlock(b.id, { source: e.target.value, translated: '' })} /></label>
          <label className="text-sm">{c.target}<textarea aria-label={`${c.target} ${b.id}`} rows={4} className={field} value={b.translated} maxLength={48_000} onChange={e => updateBlock(b.id, { translated: e.target.value })} /></label>
        </div>
        {issues.filter(issue => issue.id === b.id).map(issue => <p className="text-sm text-red-700" key={issue.reason}>{c[issue.reason]}</p>)}
      </fieldset>)}
    </section>}
  </main></>;
}
