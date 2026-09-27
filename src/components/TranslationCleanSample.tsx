'use client';
import { useRef, useState } from 'react';
import TranslationPreview from './TranslationPreview';
import { credentialHeaders } from '@/lib/account/contracts';
import { downloadBlob } from '@/lib/files';
import { batches, TranslationError, validateTranslationResult } from '@/lib/translation/contracts';
import { CLEAN_SAMPLE_LIMIT, type CleanPage } from '@/lib/translation/clean-contract';
import { cleanReferences, cleanSourceImage, exportCleanTranslation } from '@/lib/translation/clean-document';
import { requestCleanPage } from '@/lib/translation/clean-client';
import { requestRegionReview } from '@/lib/translation/review-client';
import { cleanVerificationBox, verifyCleanReading } from '@/lib/translation/clean-verification';
import type { TranslationPage } from '@/lib/translation/layout';
import { cleanTextGroups, cleanTranslationContext } from '@/lib/translation/clean-groups';

export default function TranslationCleanSample(props: {
  source: Uint8Array; pages: TranslationPage[]; busy: boolean; complete: boolean;
  provider: string; model: string; apiKey: string; savedProviderId?: string; translationConsent: boolean; glossary: string;
  locale: 'es' | 'en'; run: (work: (signal: AbortSignal) => Promise<void>) => Promise<void>;
}) {
  const es = props.locale === 'es';
  const [consent, setConsent] = useState(false), [clean, setClean] = useState<CleanPage[]>([]);
  const [output, setOutput] = useState<Uint8Array>(), [count, setCount] = useState(0), [previewPage, setPreviewPage] = useState(1);
  const [status, setStatus] = useState('');
  const completed = useRef<CleanPage[]>([]);
  const checkpoint = () => { setClean(structuredClone(completed.current)); };
  const allowed = props.complete && !props.busy && consent && props.translationConsent && props.provider === 'openai' &&
    !!props.model.trim() && (!!props.apiKey.trim() || !!props.savedProviderId);
  const sample = props.pages.slice(0, CLEAN_SAMPLE_LIMIT);
  const credentials = { apiKey: props.apiKey, savedProviderId: props.savedProviderId };
  const compact = (text: string) => text.replace(/\s+/g, ' ').trim();
  async function generate(signal: AbortSignal) {
    setOutput(undefined); setStatus('');
    for (const info of sample) {
      signal.throwIfAborted();
      if (completed.current[info.number - 1]) continue;
      setStatus(`${es ? 'Reconociendo estructura' : 'Recognizing structure'} ${info.number}/${sample.length}`);
      const reference = cleanReferences(info);
      const image = await cleanSourceImage(props.source, info, signal);
      const elements = await requestCleanPage({ model: props.model.trim(), image, blocks: reference, consent: true }, credentials, signal);
      completed.current[info.number - 1] = { number: info.number, width: info.width, height: info.height, reference,
        elements: elements.map(e => ({ ...e, translated: '' })) };
      checkpoint();
    }
    for (const p of completed.current) {
      setStatus(`${es ? 'Traduciendo contenido limpio' : 'Translating clean content'} ${p.number}/${sample.length}`);
      for (let i = 0; i < p.elements.length; i++) {
        const e = p.elements[i];
        if (e.uncertain && !e.verification && e.kind !== 'figure' && e.kind !== 'noise') {
          const image = await cleanSourceImage(props.source, p, signal, cleanVerificationBox(p, i), p.reference.filter(b => !e.ids.includes(b.id)));
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
      const first = g.parts[0], e = completed.current[first.page - 1].elements[first.element];
      if (e.translated && e.translatedSource === g.text) continue;
      const previous = e.ids.map(id => sample[first.page - 1].blocks.find(b => b.id === id));
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
          const first = g.parts[0]; completed.current[first.page - 1].elements[first.element].translated = t.text;
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
    <h2 className="text-lg font-medium">{es ? 'Documento limpio · prueba de hasta 10 páginas' : 'Clean document · up to 10-page trial'}</h2>
    <p className="text-sm">{es
      ? 'OCR + IA reconstruyen títulos, párrafos y figuras. Una fuente de 12 pt; imágenes entre los mismos párrafos, aunque cambie la página. No usa la hoja original como fondo. Beta: puede equivocarse en el orden, la lectura o los recortes. Gráficos y tablas se conservan como imágenes con sus rótulos originales, todavía sin traducir.'
      : 'OCR + AI reconstruct headings, paragraphs and figures. One 12 pt font; images stay between the same paragraphs even when pagination changes. No original-page background. Beta: reading order, transcription and crops may be wrong. Charts and tables retain their original labels as images, not yet translated.'}</p>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={consent} disabled={props.busy} onChange={e => setConsent(e.target.checked)} />
      {es ? 'Autorizo enviar las primeras 10 páginas completas como imágenes, sus textos OCR y fragmentos vecinos de la muestra como contexto a OpenAI, incluidos bloques desmarcados. Una solicitud por página, hasta dos relecturas por recorte dudoso y las traducciones necesarias, con mi API y posibles costos. No hay reintentos automáticos de solicitudes fallidas.'
        : 'I authorize sending the first 10 full-page images, their OCR text and neighboring sample excerpts as context to OpenAI, including unchecked blocks. One request per page, up to two readings per uncertain crop and necessary translations, using my API with possible costs. Failed requests are not automatically retried.'}</label>
    <p className="text-xs">{es ? 'Requiere OpenAI y la autorización de traducción de arriba. Los resultados viven sólo en esta pestaña. Cambiar el texto original o las traducciones invalida la muestra; otro clic continúa únicamente lo pendiente.'
      : 'Requires OpenAI and translation consent above. Results live only in this tab. Editing source or translations invalidates the sample; another click continues only pending work.'}</p>
    <button type="button" className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white disabled:opacity-40" disabled={!allowed}
      onClick={() => { void props.run(signal => generate(signal)); }}>{es ? 'Generar muestra limpia' : 'Generate clean sample'}</button>
    {status && <p role="status" aria-label={es ? 'Progreso de la muestra limpia' : 'Clean sample progress'} className="text-sm">{status}</p>}
    {(excluded.length > 0 || uncertain.length > 0) && <details className="text-sm"><summary>{es ? 'Ver exclusiones e incertidumbres' : 'View exclusions and uncertainty'} ({excluded.length} / {uncertain.length})</summary>
      {excluded.map((e, i) => <p key={`n${i}`}>{e.page} · {e.noiseReason}: {e.text}</p>)}
      {uncertain.map((e, i) => <p key={`u${i}`}>{e.page} · {es ? 'No resuelto' : 'Unresolved'}: {e.text}</p>)}
    </details>}
    {output && <>
      <button type="button" className="rounded border bg-white px-4 py-2 text-sm" onClick={() => downloadBlob(new Blob([output.slice().buffer], { type: 'application/pdf' }), 'traduccion-muestra-10-limpia.pdf')}>
        {es ? 'Descargar muestra limpia' : 'Download clean sample'}</button>
      <label className="block text-sm">{es ? 'Página de la muestra limpia' : 'Clean sample page'} <select value={previewPage} onChange={e => setPreviewPage(Number(e.target.value))}>
        {Array.from({ length: count }, (_, i) => <option key={i} value={i + 1}>{i + 1}/{count}</option>)}
      </select></label>
      <TranslationPreview bytes={output} page={previewPage} label={es ? 'Muestra limpia' : 'Clean sample'} />
    </>}
  </section>;
}
