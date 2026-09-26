'use client';
import { useEffect, useRef, useState } from 'react';
import Navbar from '@/components/Navbar';
import Link from 'next/link';
import { useAccount } from '@/lib/account/use-account';
import { accountCopy } from '@/lib/account/copy';
import { credentialHeaders } from '@/lib/account/contracts';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import TranslationPreview from '@/components/TranslationPreview';
import TranslationRegionReview from '@/components/TranslationRegionReview';
import { useI18n } from '@/lib/i18n/context';
import { downloadBlob, derivedFileName } from '@/lib/files';
import { batches, TranslationError, validateTranslationResult, type TranslationProvider } from '@/lib/translation/contracts';
import { pendingSegments, type TranslationBlock, type TranslationPage } from '@/lib/translation/layout';
import { translationCopy } from '@/lib/translation/copy';
import { buildTranslationContext } from '@/lib/translation/context';
import type { TranslationExportMode } from '@/lib/translation/reading';
import { analyzeTranslation, checkTranslationLayout, exportTranslation, type LayoutIssue } from '@/lib/translation/document';

const field = 'block w-full rounded-lg border border-gray-300 bg-white p-2 text-sm disabled:opacity-50';
const button = 'rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40';
const INITIAL_BATCH_LIMIT = 12;
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
  const [batchLimit, setBatchLimit] = useState(INITIAL_BATCH_LIMIT);
  const [useContext, setUseContext] = useState(false);
  const { account } = useAccount();
  const [savedProviderId, setSavedProviderId] = useState('');
  const a = accountCopy[locale];
  const [exportMode, setExportMode] = useState<TranslationExportMode>('preserve');
  const [outputLayout, setOutputLayout] = useState<{ pageCount: number; sourcePages: number[] }>();
  const [outputPage, setOutputPage] = useState(1);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const current = pages[pageIndex], pending = pendingSegments(pages).length;
  const invalidate = () => { setOutput(undefined); setOutputLayout(undefined); setOutputPage(1); setIssues([]); };
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
      invalidate(); setPages([]); setComplete(false); setPageIndex(0); setBatchLimit(INITIAL_BATCH_LIMIT);
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
      let workingPages = pages;
      const groups = batches(pendingSegments(pages), batchLimit);
      for (let i = 0; i < groups.length; i++) {
        signal.throwIfAborted(); setProgress(`${c.translateProgress} ${i + 1}/${groups.length}`);
        try {
          const response = await fetch('/api/translate', { method: 'POST', cache: 'no-store',
            signal: AbortSignal.any([signal, AbortSignal.timeout(110_000)]),
            headers: { 'Content-Type': 'application/json', ...credentialHeaders(key, savedProviderId) },
            body: JSON.stringify({ provider, model: model.trim(), baseUrl: provider === 'compatible' ? baseUrl.trim() : undefined,
              glossary, consent, segments: groups[i], context: useContext ? buildTranslationContext(workingPages, groups[i]) : [] }),
          });
          let data;
          try { data = await response.json(); }
          catch { throw new TranslationError('invalid_response'); }
          if (!response.ok) throw new TranslationError(typeof data?.error === 'string' ? data.error : 'translation_failed');
          // Recompute missing IDs locally; never trust provider-supplied completion metadata.
          const result = validateTranslationResult(data, groups[i]);
          const translations = new Map(result.translations.map(s => [s.id, s.text]));
          signal.throwIfAborted();
          const apply = (items: TranslationPage[]) => items.map(p => ({ ...p, blocks: p.blocks.map(b => translations.has(b.id) && !b.translated.trim()
            ? { ...b, translated: translations.get(b.id)! } : b) }));
          workingPages = apply(workingPages);
          setPages(apply);
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
      setOutput(undefined); setOutputLayout(undefined); setOutputPage(1);
      const found = await checkTranslationLayout(pages, exportMode); setIssues(found);
      if (found.length) { setPageIndex(found[0].page - 1); throw new TranslationError('layout_issues'); }
      const result = await exportTranslation(source, pages, signal, n => setProgress(`${c.exportProgress} ${n}/${pages.length}`),
        { mode: exportMode, complete: layout => { setOutputLayout(layout); setOutputPage(layout.sourcePages[pageIndex] ?? 1); } });
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
        setFile(files[0]); setSource(undefined); setPages([]); setComplete(false); setError(''); setConsent(false); setBatchLimit(INITIAL_BATCH_LIMIT); invalidate();
      }}>{file?.name ?? t.common.choosePdf}</FileDropzone>
      <p className="text-sm text-gray-600">{c.analyzeHelp}</p>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={forceOcr} disabled={busy} onChange={e => setForceOcr(e.target.checked)} />{c.force}</label>
      <button className={button} disabled={!file || busy} onClick={analyze}>{c.analyze}</button>
    </section>
    <fieldset disabled={busy} className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
      {account?.user ? <label className="text-sm sm:col-span-2">{a.select}<select className={field} value={savedProviderId} onChange={e => {
        const selected = account.providers.find(p => p.id === e.target.value);
        setSavedProviderId(selected?.id ?? ''); setKey(''); setConsent(false);
        if (selected) { setProvider(selected.provider); setModel(selected.model); setBaseUrl(selected.baseUrl ?? ''); }
      }}><option value="">{a.temporary}</option>{account.providers.map(p => <option key={p.id} value={p.id}>{p.label} · {p.keyHint}</option>)}</select>
        <Link className="mt-1 inline-block text-violet-700 underline" href={`/${locale}/account`}>{a.manage}</Link>
      </label> : <Link className="text-sm text-violet-700 underline sm:col-span-2" href={`/${locale}/account`}>{a.connect}</Link>}
      <label className="text-sm">{c.provider}<select disabled={!!savedProviderId} className={field} value={provider} onChange={e => {
        const value = e.target.value as TranslationProvider; setProvider(value); setKey(''); setConsent(false);
        setModel(value === 'openai' ? 'gpt-4.1-mini' : value === 'gemini' ? 'gemini-2.5-flash' : '');
      }}><option value="openai">OpenAI</option><option value="gemini">Gemini</option><option value="compatible">OpenAI-compatible / OpenRouter</option></select></label>
      <label className="text-sm">{c.model}<input disabled={!!savedProviderId} className={field} value={model} onChange={e => { setModel(e.target.value); setConsent(false); }} maxLength={120} /></label>
      {provider === 'compatible' && <label className="text-sm sm:col-span-2">{c.endpoint}<input disabled={!!savedProviderId} className={field} value={baseUrl} onChange={e => { setBaseUrl(e.target.value); setConsent(false); setKey(''); }} /><span>{c.custom}</span></label>}
      {savedProviderId ? <p className="text-sm sm:col-span-2">{a.using}: {account?.providers.find(p => p.id === savedProviderId)?.label}</p> : <>
        <label className="text-sm">{c.key}<input className={field} type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} maxLength={2048} /></label>
        <button className="self-end rounded-lg border p-2 text-sm" onClick={() => { setKey(''); setConsent(false); }}>{c.clear}</button>
      </>}
      <label className="text-sm sm:col-span-2">{c.glossary}<textarea className={field} value={glossary} maxLength={3000} onChange={e => { setGlossary(e.target.value); setConsent(false); }} /></label>
      <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={useContext} onChange={e => { setUseContext(e.target.checked); setConsent(false); }} />{c.context}</label>
      <p className="text-xs text-gray-600 sm:col-span-2">{c.contextHelp}</p>
      <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />{c.consent}</label>
    </fieldset>
    <label className="block text-sm">{c.exportMode}<select className={field} disabled={busy} value={exportMode} onChange={e => {
      setExportMode(e.target.value as TranslationExportMode); invalidate();
    }}><option value="preserve">{c.preserveMode}</option><option value="readable">{c.readableMode}</option></select></label>
    {exportMode === 'readable' && <p className="rounded border border-blue-200 bg-blue-50 p-3 text-sm">{c.readableHelp}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <button className={button} disabled={busy || !complete || !pending || !consent || (!savedProviderId && !key.trim()) || !model.trim()} onClick={translate}>{c.translate}</button>
      <button className={button} disabled={busy || !complete || pending > 0 || !pages.some(p => p.blocks.some(b => b.included))} onClick={preview}>{c.preview}</button>
      {output && <button className={button} onClick={() => downloadBlob(new Blob([output.slice().buffer as ArrayBuffer], { type: 'application/pdf' }), derivedFileName(file!.name, '_es-AR.pdf'))}>{c.download}</button>}
      {busy && <button className="rounded-lg border px-4 py-2" onClick={() => controller.current?.abort()}>{c.cancel}</button>}
    </div>
    <p role="status" className="text-sm">{progress || (pages.length ? `${pending} ${c.pending}` : '')}</p>
    {batchLimit < INITIAL_BATCH_LIMIT && <p className="text-sm text-amber-800">{c.recovery} {batchLimit} {c.recoveryLimit}</p>}
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm">{error}<p>{c.kept}</p></div>}
    {current && <section className="space-y-4">
      <div className="flex gap-3"><h2 className="text-xl font-medium">{c.review}</h2>
        <label>{c.page} <select aria-label={c.page} disabled={busy} value={pageIndex} onChange={e => {
          const index = Number(e.target.value); setPageIndex(index); setOutputPage(outputLayout?.sourcePages[index] ?? index + 1);
        }}>
          {pages.map((p, i) => <option value={i} key={p.number}>{p.number} ({p.method.toUpperCase()})</option>)}
        </select></label></div>
      <p className="text-sm text-amber-800">{c.excluded}</p>
      {current.warnings.length > 0 && <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">{c.warnings}: {current.warnings.map(w => c[w as 'no_text' | 'rotated_text' | 'outside_page']).join(' ')}</div>}
      {source && <div className="grid gap-4 md:grid-cols-2"><TranslationPreview bytes={source} page={current.number} label={c.original} />
        {output && <div>
          {outputLayout && <label className="block text-sm">{c.outputPage}<select aria-label={c.outputPage} value={outputPage}
            onChange={e => setOutputPage(Number(e.target.value))}>
            {Array.from({ length: outputLayout.pageCount }, (_, i) => <option key={i} value={i + 1}>{i + 1} / {outputLayout.pageCount}</option>)}
          </select></label>}
          <TranslationPreview bytes={output} page={outputPage} label={c.result} />
        </div>}</div>}
      {current.blocks.map(b => <fieldset key={b.id} disabled={busy} className="space-y-2 rounded-xl border p-4">
        <label className="flex gap-2 text-sm font-medium"><input type="checkbox" checked={b.included} onChange={e => updateBlock(b.id, { included: e.target.checked })} />{b.id} · {c.include}</label>
        <p className="text-xs text-gray-500">{b.font} · {b.size.toFixed(1)} pt{b.confidence !== undefined ? ` · OCR ${Math.round(b.confidence)}/100` : ''}</p>
        {b.confidence !== undefined && b.confidence < 60 && <p className="text-sm text-amber-800">{c.low}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">{c.source}<textarea aria-label={`${c.source} ${b.id}`} rows={4} className={field} value={b.source} maxLength={12_000} onChange={e => updateBlock(b.id, { source: e.target.value, translated: '' })} /></label>
          <label className="text-sm">{c.target}<textarea aria-label={`${c.target} ${b.id}`} rows={4} className={field} value={b.translated} maxLength={48_000} onChange={e => updateBlock(b.id, { translated: e.target.value })} /></label>
        </div>
        {source && <TranslationRegionReview key={`${b.id}:${provider}:${model}:${savedProviderId}`} source={source} page={current} block={b}
          busy={busy} provider={provider} model={model} apiKey={key} savedProviderId={savedProviderId} locale={locale} run={run}
          apply={text => updateBlock(b.id, { source: text, translated: '' })} />}
        {issues.filter(issue => issue.id === b.id).map(issue => <p className="text-sm text-red-700" key={issue.reason}>{c[issue.reason]}</p>)}
      </fieldset>)}
    </section>}
  </main></>;
}
