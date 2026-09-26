'use client';
import { useState } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { useI18n } from '@/lib/i18n/context';
import { useAccount } from '@/lib/account/use-account';
import { accountCopy } from '@/lib/account/copy';
import type { TranslationProvider } from '@/lib/translation/contracts';
import OpenAIModelPicker from '@/components/OpenAIModelPicker';
import { DEFAULT_OPENAI_MODEL } from '@/lib/openai/models';

const field = 'mt-1 block w-full rounded-lg border border-gray-300 bg-white p-2 text-sm';
const button = 'inline-block rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40';
export default function AccountPage() {
  const { locale } = useI18n(), c = accountCopy[locale];
  const { account, failed, refresh } = useAccount();
  const [label, setLabel] = useState(''), [provider, setProvider] = useState<TranslationProvider>('openai');
  const [model, setModel] = useState<string>(DEFAULT_OPENAI_MODEL), [baseUrl, setBaseUrl] = useState('https://openrouter.ai/api/v1');
  const [apiKey, setApiKey] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function change(removeId?: string) {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/account/providers', { method: removeId ? 'DELETE' : 'POST',
        cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(removeId ? { id: removeId } : { label, provider, model: model.trim(), apiKey: apiKey.trim(),
          ...(provider === 'compatible' ? { baseUrl: baseUrl.trim() } : {}) }),
      });
      if (!response.ok) {
        const data = await response.json();
        setMessage(response.status === 401 ? c.session : data.error === 'provider_limit' ? c.limit
          : ['invalid_request', 'endpoint_not_allowed'].includes(data.error) ? c.invalid : c.unavailable);
        return;
      }
      setApiKey(''); setMessage(removeId ? c.removed : c.saved);
      if (!removeId) setLabel('');
      await refresh();
    } catch { setMessage(c.unavailable); }
    finally { setBusy(false); }
  }
  const returnTo = encodeURIComponent(`/${locale}/account`);
  return <><Navbar /><main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10">
    <header><h1 className="text-3xl font-semibold">{c.title}</h1><p className="mt-2 text-gray-600">{c.intro}</p></header>
    <p className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm">{c.privacy}</p>
    {failed ? <div role="alert">{c.unavailable} <button className={button} onClick={() => void refresh()}>{c.retry}</button></div>
      : !account ? <p role="status">{c.loading}</p>
      : !account.available ? <p role="status">{c.notConfigured}</p>
      : !account.user ? <section className="space-y-4 rounded-xl border p-6">
        <p>{c.welcome}</p><div className="flex flex-wrap gap-3">
          <a className={button} href={`/auth/login?returnTo=${returnTo}&ui_locales=${locale}`}>{c.login}</a>
          <a className="rounded-lg border px-4 py-2 text-sm" href={`/auth/login?screen_hint=signup&returnTo=${returnTo}&ui_locales=${locale}`}>{c.signup}</a>
        </div>
      </section> : <>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <div><p className="font-medium">{account.user.name}</p><p className="text-sm text-gray-600">{account.user.email}</p></div>
          {/* Auth0 needs a full navigation to establish/clear session cookies. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="rounded-lg border px-4 py-2 text-sm" href="/auth/logout">{c.logout}</a>
        </div>
        {account.user.id && <details className="text-xs text-gray-600"><summary>{c.identity}</summary>
          <code className="mt-2 block break-all">{account.user.id}</code></details>}
        <section className="space-y-3"><h2 className="text-xl font-medium">{c.providers}</h2>
          {!account.providers.length && <p className="text-sm text-gray-600">{c.empty}</p>}
          {account.providers.map(p => <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <div><p className="font-medium">{p.label}</p><p className="break-all text-sm text-gray-600">{p.provider} · {p.model} · {p.keyHint}</p>
              {p.baseUrl && <p className="break-all text-xs text-gray-500">{p.baseUrl}</p>}</div>
            <button disabled={busy} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40" onClick={() => void change(p.id)}>{c.remove}</button>
          </div>)}
        </section>
        <form onSubmit={e => { e.preventDefault(); void change(); }}>
          <fieldset disabled={busy} className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
            <label className="text-sm">{c.label}<input required className={field} value={label} maxLength={80} onChange={e => setLabel(e.target.value)} /></label>
            <label className="text-sm">{c.provider}<select className={field} value={provider} onChange={e => {
              const p = e.target.value as TranslationProvider; setProvider(p); setApiKey('');
              setModel(p === 'openai' ? DEFAULT_OPENAI_MODEL : p === 'gemini' ? 'gemini-2.5-flash' : '');
            }}><option value="openai">OpenAI</option><option value="gemini">Gemini</option><option value="compatible">OpenAI-compatible / OpenRouter</option></select></label>
            {provider === 'openai' ? <OpenAIModelPicker value={model} onChange={setModel} apiKey={apiKey} locale={locale} disabled={busy} />
              : <label className="text-sm">{c.model}<input required className={field} value={model} maxLength={120} onChange={e => setModel(e.target.value)} /></label>}
            <label className="text-sm">{c.key}<input required className={field} type="password" autoComplete="off" spellCheck={false} value={apiKey} maxLength={2048} onChange={e => setApiKey(e.target.value)} /></label>
            {provider === 'compatible' && <label className="text-sm sm:col-span-2">{c.endpoint}<input required className={field} value={baseUrl} maxLength={500} onChange={e => { setBaseUrl(e.target.value); setApiKey(''); }} /></label>}
            <p className="text-sm text-gray-600 sm:col-span-2">{c.billing}</p>
            <button className={button} type="submit" disabled={!label.trim() || !apiKey.trim() || !model.trim()}>{c.save}</button>
          </fieldset>
        </form>
        <Link className={button} href={`/${locale}/translate`}>{c.translate}</Link>
      </>}
    <p role="status" className="text-sm">{message}</p>
  </main></>;
}
