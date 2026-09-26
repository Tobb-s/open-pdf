'use client';
import { useEffect, useRef, useState } from 'react';
import { credentialHeaders } from '@/lib/account/contracts';
import type { OpenAIModel } from '@/lib/openai/models';

const copy = {
  es: { model: 'Modelo', load: 'Consultar modelos de mi API', loading: 'Consultando modelos…', pick: 'Elegir del catálogo',
    help: 'Consulta el catálogo de esta clave, sin enviar texto ni PDF. La disponibilidad no garantiza saldo, permisos de uso ni compatibilidad de cada modelo. También podés escribir un ID manualmente.',
    other: 'No compatible con esta herramienta', fail: 'No pudimos consultar el catálogo. Revisá la clave, los permisos o tu sesión; podés reintentar o ingresar el modelo manualmente.', count: 'modelos disponibles en el catálogo' },
  en: { model: 'Model', load: 'Fetch my API models', loading: 'Fetching models…', pick: 'Select from catalog',
    help: 'Fetches this key’s catalog without sending text or PDFs. Listing does not guarantee balance, usage permissions or compatibility of every model. You can also enter an ID manually.',
    other: 'Not compatible with this tool', fail: 'Could not fetch the catalog. Check your key, permissions or session; retry or enter a model manually.', count: 'models in the catalog' },
};
export default function OpenAIModelPicker({ value, onChange, apiKey, savedProviderId, locale, disabled = false }: {
  value: string; onChange: (value: string) => void; apiKey: string; savedProviderId?: string; locale: 'es' | 'en'; disabled?: boolean;
}) {
  const c = copy[locale];
  const [models, setModels] = useState<OpenAIModel[]>(), [loading, setLoading] = useState(false), [failed, setFailed] = useState(false);
  const [identity, setIdentity] = useState({ apiKey, savedProviderId });
  const controller = useRef<AbortController>(undefined), generation = useRef(0);
  // Guarded render-time reset prevents displaying a previous credential's catalog,
  // even for one frame. Both temporary keys and catalogs remain memory-only.
  if (identity.apiKey !== apiKey || identity.savedProviderId !== savedProviderId) {
    setIdentity({ apiKey, savedProviderId }); setModels(undefined); setFailed(false); setLoading(false);
  }
  useEffect(() => {
    generation.current++; controller.current?.abort();
    return () => { controller.current?.abort(); };
  }, [apiKey, savedProviderId]);
  async function load() {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const version = ++generation.current;
    setLoading(true); setFailed(false); setModels(undefined);
    try {
      const response = await fetch('/api/models', { method: 'POST', cache: 'no-store',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
        headers: { 'Content-Type': 'application/json', ...credentialHeaders(apiKey, savedProviderId) },
        body: JSON.stringify({ provider: 'openai' }) });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.models)) throw new Error();
      if (generation.current === version && !abort.signal.aborted) setModels(data.models);
    } catch { if (generation.current === version && !abort.signal.aborted) setFailed(true); }
    finally { if (generation.current === version && !abort.signal.aborted) setLoading(false); }
  }
  const field = 'mt-1 block w-full rounded-lg border border-gray-300 bg-white p-2 text-sm disabled:opacity-50';
  return <div className="space-y-2 text-sm">
    <label>{c.model}<input required className={field} value={value} maxLength={120} disabled={disabled}
      onChange={e => onChange(e.target.value)} /></label>
    <button type="button" disabled={disabled || loading || (!savedProviderId && !apiKey.trim())}
      className="rounded-lg border px-3 py-2 disabled:opacity-40" onClick={() => void load()}>{loading ? c.loading : c.load}</button>
    {models && <><label>{c.pick}<select aria-label={c.pick} className={field} disabled={disabled} value="" onChange={e => { if (e.target.value) onChange(e.target.value); }}>
      <option value="">{c.pick}</option>
      {models.map(m => <option key={m.id} value={m.id} disabled={m.kind !== 'text'}>{m.id}{m.kind !== 'text' ? ` — ${c.other}` : ''}</option>)}
    </select></label><p role="status">{models.length} {c.count}</p></>}
    {failed && <p role="alert">{c.fail}</p>}
    <p className="text-xs text-gray-600">{c.help}</p>
  </div>;
}
