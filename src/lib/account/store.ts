import 'server-only';
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import type { SavedProvider } from './contracts';
import { openCredential, sealCredential } from './crypto';
import { TranslationError } from '@/lib/translation/contracts';
import { providerUrl } from '@/lib/translation/provider';

function db() {
  if (!process.env.DATABASE_URL) throw new TranslationError('account_unavailable', 503);
  return neon(process.env.DATABASE_URL);
}
interface Row { id: string; label: string; provider: SavedProvider['provider']; model: string;
  base_url: string | null; key_hint: string; ciphertext?: string }
function publicProvider(row: Row): SavedProvider {
  return { id: row.id, label: row.label, provider: row.provider, model: row.model,
    ...(row.base_url ? { baseUrl: row.base_url } : {}), keyHint: row.key_hint };
}
function binding(owner: string, row: Pick<Row, 'id' | 'provider' | 'model' | 'base_url'>) {
  return JSON.stringify([owner, row.id, row.provider, row.model, row.base_url]);
}
export async function listProviders(owner: string): Promise<SavedProvider[]> {
  const rows = await db()`SELECT id, label, provider, model, base_url, key_hint
    FROM openpdf_provider_credentials WHERE owner_id = ${owner} ORDER BY created_at`;
  return (rows as Row[]).map(publicProvider);
}
export async function saveProvider(owner: string, input: Omit<SavedProvider, 'id' | 'keyHint'> & { apiKey: string }) {
  // Validate destinations before storing and again before use. Never send a saved key to an arbitrary host.
  providerUrl({ ...input, glossary: '', consent: true, segments: [] }, process.env.TRANSLATION_COMPATIBLE_BASE_URLS);
  const sql = db(), id = randomUUID(), base = input.baseUrl ?? null;
  const ciphertext = sealCredential(input.apiKey, binding(owner, { id, provider: input.provider, model: input.model, base_url: base }));
  const keyHint = `••••${input.apiKey.slice(-4)}`;
  const rows = await sql`INSERT INTO openpdf_provider_credentials
    (id, owner_id, label, provider, model, base_url, key_hint, ciphertext)
    SELECT ${id}, ${owner}, ${input.label}, ${input.provider}, ${input.model}, ${base}, ${keyHint}, ${ciphertext}
    WHERE (SELECT count(*) FROM openpdf_provider_credentials WHERE owner_id = ${owner}) < 10
    RETURNING id, label, provider, model, base_url, key_hint`;
  if (!rows.length) throw new TranslationError('provider_limit', 409);
  return publicProvider(rows[0] as Row);
}
export async function deleteProvider(owner: string, id: string) {
  const rows = await db()`DELETE FROM openpdf_provider_credentials WHERE owner_id = ${owner} AND id = ${id} RETURNING id`;
  if (!rows.length) throw new TranslationError('provider_not_found', 404);
}
export async function loadProvider(owner: string, id: string) {
  const rows = await db()`SELECT id, label, provider, model, base_url, key_hint, ciphertext
    FROM openpdf_provider_credentials WHERE owner_id = ${owner} AND id = ${id}`;
  if (!rows.length) throw new TranslationError('provider_not_found', 404);
  const row = rows[0] as Row;
  return { ...publicProvider(row), apiKey: openCredential(row.ciphertext!, binding(owner, row)) };
}
