'use client';
import { useRef, useState } from 'react';
import TranslationPreview from './TranslationPreview';
import { credentialHeaders } from '@/lib/account/contracts';
import { downloadBlob } from '@/lib/files';
import { batches, TranslationError, validateTranslationResult } from '@/lib/translation/contracts';
import { type CleanPage } from '@/lib/translation/clean-contract';
import { cleanReferences, cleanSourceImage, exportCleanTranslation } from '@/lib/translation/clean-document';
import { requestCleanPage } from '@/lib/translation/clean-client';
import { requestRegionReview } from '@/lib/translation/review-client';
import { cleanVerificationBox, cleanVerificationMask, cleanMarginCandidate, cleanMarginContext, cleanMarginReviewBox, verifyCleanReading } from '@/lib/translation/clean-verification';
import type { TranslationPage } from '@/lib/translation/layout';
import { cleanTextGroups, cleanTranslationContext } from '@/lib/translation/clean-groups';

export default function TranslationCleanSample(props: {
  source: Uint8Array; pages: TranslationPage[]; busy: boolean; complete: boolean;
  provider: string; model: string; apiKey: string; savedProviderId?: string; glossary: string; fileName: string;
  locale: 'es' | 'en'; run: (work: (signal: AbortSignal) => Promise<void>) => Promise<void>;
}) {
  const es = props.locale === 'es';
  const [consent, setConsent] = useState(false), [clean, setClean] = useState<CleanPage[]>([]);
  const [output, setOutput] = useState<Uint8Array>(), [count, setCount] = useState(0), [previewPage, setPreviewPage] = useState(1);
  const [status, setStatus] = useState('');
  const completed = useRef<CleanPage[]>([]);
  const checkpoint = () => { setClean(structuredClone(completed.current)); };
  const allowed = props.complete && !props.busy && consent && props.provider === 'openai' &&
    !!props.model.trim() && (!!props.apiKey.trim() || !!props.savedProviderId);
  const sample = props.pages;
  const sampleIndex = new Map(sample.map((page, index) => [page.number, index]));
  const credentials = { apiKey: props.apiKey, savedProviderId: props.savedProviderId };
  const compact = (text: string) => text.replace(/\s+/g, ' ').trim();
  async function generate(signal: AbortSignal) {
    setOutput(undefined); setStatus('');
    for (const [index, info] of sample.entries()) {
      signal.throwIfAborted();
      if (completed.current[index]) continue;
      setStatus(`${es ? 'Reconociendo estructura' : 'Recognizing structure'} ${index + 1}/${sample.length} (${es ? 'página' : 'page'} ${info.number})`);
      const reference = cleanReferences(info);
      const image = await cleanSourceImage(props.source, info, signal);
      const elements = await requestCleanPage({ model: props.model.trim(), image, blocks: reference, consent: true }, credentials, signal);
      completed.current[index] = { number: info.number, width: info.width, height: info.height, reference,
        elements: elements.map(e => ({ ...e, translated: '' })) };
      checkpoint();
    }
    for (const [index, p] of completed.current.entries()) {
      setStatus(`${es ? 'Traduciendo contenido limpio' : 'Translating clean content'} ${index + 1}/${sample.length} (${es ? 'página' : 'page'} ${p.number})`);
      for (let i = 0; i < p.elements.length; i++) {
        const e = p.elements[i];
        if (cleanMarginCandidate(e) && (e.uncertain || /\[(?:illegible|ilegible)\]/i.test(e.translated))) {
          const image = await cleanSourceImage(props.source, p, signal, cleanMarginReviewBox(e));
          const result = await requestRegionReview({ model: props.model.trim(), image, sourceText: cleanMarginContext(p, i), task: 'classify_noise' }, credentials, signal);
          if (result.uncertain) throw new TranslationError('clean_uncertain');
          e.text = result.text; e.uncertain = false; e.translated = ''; e.verification = { text: result.text, model: props.model.trim() };
          if (result.noiseReason !== 'none') { e.kind = 'noise'; e.noiseReason = result.noiseReason!; }
          checkpoint();
        }
        if (e.uncertain && !e.verification && e.kind !== 'figure' && e.kind !== 'noise') {
          const image = await cleanSourceImage(props.source, p, signal, cleanVerificationBox(p, i), cleanVerificationMask(p, i));
          const sourceText = e.ids.map(id => p.reference.find(b => b.id === id)?.text ?? '').join(' ').slice(0, 12000);
          const text = await verifyCleanReading(e.text, () => requestRegionReview({ model: props.model.trim(), image, sourceText }, credentials, signal));
          if (text) { e.text = text; e.verification = { text, model: props.model.trim() }; e.uncertain = false; checkpoint(); }
        }
        if (e.uncertain) throw new TranslationError('clean_uncertain');
      }
      checkpoint();
    }
    const groups = cleanTextGroups(completed.current), pending: { id: string; text: string }[] = [];
    for (const g of groups) {
      const first = g.parts[0], e = completed.current[sampleIndex.get(first.page)!].elements[first.element];
      if (e.translated && e.translatedSource === g.text) continue;
      const previous = [...new Set(e.ids.map(id => id.replace(/_l\d+$/, '')))].map(id => sample[sampleIndex.get(first.page)!].blocks.find(b => b.id === id));
      if (g.parts.length === 1 && previous.length && previous.every(b => b?.translated.trim()) &&
          compact(previous.map(b => b!.source).join(' ')) === compact(g.text)) e.translated = previous.map(b => b!.translated).join(' ');
      else { e.translated = ''; pending.push({ id: g.id, text: g.text }); }
      e.translatedSource = g.text;
    }
    checkpoint();
    for (const segments of batches(pending, 6)) {
        signal.throwIfAborted();
        const response = await fetch('/api/translate', { method: 'POST', cache: 'no-store',
          signal: AbortSignal.any([signal, AbortSignal.timeout(110000)]),
          headers: { 'Content-Type': 'application/json', ...credentialHeaders(props.apiKey, props.savedProviderId) },
          body: JSON.stringify({ provider: 'openai', model: props.model.trim(), segments, glossary: props.glossary,
            context: cleanTranslationContext(completed.current, segments), consent: true }) });
        let data;
        try { data = await response.json(); } catch { throw new TranslationError('invalid_response'); }
        signal.throwIfAborted();
        if (!response.ok) throw new TranslationError(typeof data?.error === 'string' ? data.error : 'translation_failed');
        const result = validateTranslationResult(data, segments);
        for (const t of result.translations) {
          const g = groups.find(g => g.id === t.id)!;
          const first = g.parts[0]; completed.current[sampleIndex.get(first.page)!].elements[first.element].translated = t.text;
        }
        checkpoint();
        if (result.missingIds.length) throw new TranslationError('partial_response');
    }
    setStatus(es ? 'Generando documento limpio' : 'Generating clean document');
    const result = await exportCleanTranslation(props.source, completed.current, signal);
    setOutput(result.bytes); setCount(result.layout.pageCount); setPreviewPage(1); setStatus('');
  }
  const excluded = clean.flatMap(p => p.elements.filter(e => e.kind === 'noise').map(e => ({ ...e, page: p.number })));
  const uncertain = clean.flatMap(p => p.elements.filter(e => e.uncertain).map(e => ({ ...e, page: p.number })));
  return <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-4">
    <h2 className="text-lg font-medium">{es ? 'Tu PDF en español' : 'Your PDF in Spanish'}</h2>
    <p className="text-sm text-gray-700">{es
      ? `Traduciremos ${sample.length} ${sample.length === 1 ? 'página' : 'páginas'} con OCR e IA. El texto tendrá una letra uniforme y las imágenes conservarán su lugar entre párrafos.`
      : `We will translate ${sample.length} ${sample.length === 1 ? 'page' : 'pages'} with OCR and AI. Text will use a uniform font; figures remain between paragraphs.`}</p>
    <details className="text-sm text-gray-600"><summary>{es ? 'Qué se conserva y qué puede variar' : 'What remains and what may change'}</summary><p className="mt-2">{es
      ? 'El orden de lectura y las figuras se preservan, aunque cambie la paginación. No se replica la estética original. Revisá el resultado: OCR e IA pueden fallar y los rótulos dentro de imágenes todavía quedan en su idioma original.'
      : 'Reading order and figures are preserved, though pagination may change. Original styling is not reproduced. Check the result: OCR and AI can err, and labels inside images remain untranslated.'}</p></details>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={consent} disabled={props.busy} onChange={e => setConsent(e.target.checked)} />
      {es ? `Autorizo enviar ${sample.length === 1 ? 'la página elegida' : `las ${sample.length} páginas elegidas`} como ${sample.length === 1 ? 'imagen' : 'imágenes'}, su texto OCR (incluso bloques desmarcados) y fragmentos vecinos a OpenAI con mi API. Puede tener costo.`
        : `I authorize sending ${sample.length === 1 ? 'the selected page' : `all ${sample.length} selected pages`} as images, OCR text (including unchecked blocks), and neighboring excerpts to OpenAI using my API. Charges may apply.`}</label>
    <details className="text-xs text-gray-600"><summary>{es ? 'Detalles de privacidad y llamadas a la API' : 'Privacy and API call details'}</summary><p className="mt-2">{es
      ? 'Se hace una lectura de estructura por página, hasta dos revisiones por recorte dudoso y las traducciones necesarias. No hay reintentos automáticos de solicitudes fallidas. Los resultados viven sólo en esta pestaña; volver a pulsar continúa únicamente lo pendiente. Rigen las políticas de retención de OpenAI y de la infraestructura.'
      : 'One structure pass per page, up to two reviews per doubtful crop and the required translations. Failed requests are not retried automatically. Results remain only in this tab; clicking again resumes pending work. OpenAI and infrastructure retention policies apply.'}</p></details>
    <button type="button" className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white disabled:opacity-40" disabled={!allowed}
      onClick={() => { void props.run(signal => generate(signal)); }}>{es ? 'Traducir al español' : 'Translate to Spanish'}</button>
    {status && <p role="status" aria-label={es ? 'Progreso del PDF en español' : 'Spanish PDF progress'} className="text-sm">{status}</p>}
    {(excluded.length > 0 || uncertain.length > 0) && <details className="text-sm"><summary>{es ? 'Ver exclusiones e incertidumbres' : 'View exclusions and uncertainty'} ({excluded.length} / {uncertain.length})</summary>
      {excluded.map((e, i) => <p key={`n${i}`}>{e.page} · {e.noiseReason}: {e.text}</p>)}
      {uncertain.map((e, i) => <p key={`u${i}`}>{e.page} · {es ? 'No resuelto' : 'Unresolved'}: {e.text}</p>)}
    </details>}
    {output && <>
      <button type="button" className="rounded border bg-white px-4 py-2 text-sm" onClick={() => downloadBlob(new Blob([output.slice().buffer], { type: 'application/pdf' }), props.fileName.replace(/\.pdf$/i, '') + '_es-AR.pdf')}>
        {es ? 'Descargar PDF en español' : 'Download Spanish PDF'}</button>
      <label className="block text-sm">{es ? 'Página del PDF en español' : 'Spanish PDF page'} <select value={previewPage} onChange={e => setPreviewPage(Number(e.target.value))}>
        {Array.from({ length: count }, (_, i) => <option key={i} value={i + 1}>{i + 1}/{count}</option>)}
      </select></label>
      <TranslationPreview bytes={output} page={previewPage} label={es ? 'PDF en español' : 'Spanish PDF'} />
    </>}
  </section>;
}
