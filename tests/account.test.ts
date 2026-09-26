import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { session, query } = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/account/auth', () => ({ requireAccount: session }));
vi.mock('@neondatabase/serverless', () => ({ neon: () => query }));
import { sealCredential, openCredential } from '@/lib/account/crypto';
import { validateProvider, credentialHeaders } from '@/lib/account/contracts';
import { deleteProvider, listProviders, loadProvider, saveProvider } from '@/lib/account/store';
import { resolveCredential } from '@/lib/account/credential';
import { POST, DELETE } from '@/app/api/account/providers/route';
import { POST as translate } from '@/app/api/translate/route';
import { POST as review } from '@/app/api/translation-review/route';
import { TranslationError } from '@/lib/translation/contracts';

const id = '12345678-1234-1234-1234-123456789abc';
const input = { label: 'Personal', provider: 'openai' as const, model: 'gpt-4.1-mini', apiKey: 'private-test-key-1234' };
const row = { id, label: input.label, provider: input.provider, model: input.model, base_url: null, key_hint: '••••1234' };
function request(body: unknown, headers: Record<string, string> = {}, path = '/api/account/providers') {
  return new Request(`https://openpdf.test${path}`, { method: 'POST', headers: {
    origin: 'https://openpdf.test', 'content-type': 'application/json', ...headers,
  }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.stubEnv('ACCOUNT_VAULT_KEY', 'a'.repeat(64)); vi.stubEnv('DATABASE_URL', 'postgresql://test');
  session.mockReset().mockResolvedValue({ sub: 'owner-A', ownerId: 'owner-A' }); query.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('private account credentials', () => {
  it('encrypts with unique nonces and binds ciphertext to the owner and record', () => {
    const a = sealCredential(input.apiKey, 'owner-A:record'), b = sealCredential(input.apiKey, 'owner-A:record');
    expect(a).not.toBe(b); expect(a).not.toContain(input.apiKey);
    expect(openCredential(a, 'owner-A:record')).toBe(input.apiKey);
    expect(() => openCredential(a, 'owner-B:record')).toThrow();
    expect(() => openCredential(a, 'owner-A:other')).toThrow();
    const parts = a.split('.'); parts[2] = Buffer.alloc(16).toString('base64url');
    expect(() => openCredential(parts.join('.'), 'owner-A:record')).toThrow();
    vi.stubEnv('ACCOUNT_VAULT_KEY', 'b'.repeat(64)); expect(() => openCredential(a, 'owner-A:record')).toThrow();
  });
  it('rejects absent encryption configuration without substituting another key', () => {
    vi.stubEnv('ACCOUNT_VAULT_KEY', ''); expect(() => sealCredential(input.apiKey, 'A')).toThrow();
  });
  it('drops client-supplied owner IDs and credentials from public metadata', async () => {
    expect(validateProvider({ ...input, owner_id: 'owner-B' })).toEqual(input);
    query.mockResolvedValue([{ ...row, ciphertext: 'encrypted', owner_id: 'owner-B', apiKey: input.apiKey }]);
    const publicData = await listProviders('owner-A');
    expect(publicData).toEqual([{ id, label: row.label, provider: row.provider, model: row.model, keyHint: row.key_hint }]);
    expect(JSON.stringify(publicData)).not.toContain(input.apiKey);
    const [strings, ...values] = query.mock.calls[0]; expect(strings.join('')).toContain('WHERE owner_id =');
    expect(values).toEqual(['owner-A']);
  });
  it('stores ciphertext instead of plaintext with ownership supplied by the session', async () => {
    query.mockResolvedValue([row]);
    await saveProvider('owner-A', input);
    const [strings, ...values] = query.mock.calls[0];
    expect(strings.join('')).toContain('ciphertext'); expect(values).toContain('owner-A');
    expect(values).not.toContain(input.apiKey);
    const envelope = values.find(v => typeof v === 'string' && v.startsWith('v1.'));
    expect(envelope).toBeDefined();
  });
  it('does not store keys against unapproved destinations', async () => {
    await expect(saveProvider('owner-A', { ...input, provider: 'compatible', baseUrl: 'https://evil.example' })).rejects.toThrow('endpoint_not_allowed');
    expect(query).not.toHaveBeenCalled();
  });
  it('limits saved providers without silently deleting existing entries', async () => {
    query.mockResolvedValue([]); await expect(saveProvider('owner-A', input)).rejects.toThrow('provider_limit');
  });
  it('requires owner AND record ID on read and delete, and rejects foreign IDs', async () => {
    query.mockResolvedValue([]);
    await expect(loadProvider('owner-B', id)).rejects.toThrow('provider_not_found');
    await expect(deleteProvider('owner-B', id)).rejects.toThrow('provider_not_found');
    for (const [strings, ...values] of query.mock.calls) {
      expect(strings.join('')).toContain('WHERE owner_id ='); expect(strings.join('')).toContain('AND id =');
      expect(values).toEqual(['owner-B', id]);
    }
  });
  it('reads a saved key only for an authenticated owner with matching settings', async () => {
    query.mockResolvedValue([{ ...row, ciphertext: sealCredential(input.apiKey, JSON.stringify(['owner-A', id, row.provider, row.model, null])) }]);
    const req = request({}, { 'X-OpenPDF-Provider': id });
    expect(await resolveCredential(req, input)).toBe(input.apiKey);
    await expect(resolveCredential(req, { ...input, provider: 'gemini' })).rejects.toThrow('provider_mismatch');
    expect(await resolveCredential(req, { ...input, model: 'gpt-6-luna' })).toBe(input.apiKey);
    await expect(resolveCredential(req, { ...input, baseUrl: 'https://evil.example' })).rejects.toThrow('provider_mismatch');
  });
  it('keeps explicit guest keys independent and never falls back to the development key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'owner-development-key');
    expect(await resolveCredential(request({}, credentialHeaders(input.apiKey)), input)).toBe(input.apiKey);
    expect(session).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
    await expect(resolveCredential(request({}), input)).rejects.toThrow('key_required');
    await expect(resolveCredential(request({}, { ...credentialHeaders(input.apiKey), 'X-OpenPDF-Provider': id }), input)).rejects.toThrow('invalid_request');
  });
  it('rejects expired sessions before reading saved keys or contacting either AI endpoint', async () => {
    session.mockRejectedValue(new TranslationError('login_required', 401));
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const translated = await translate(request({ ...input, glossary: '', consent: true, segments: [{ id: 'p1', text: 'Hello' }] },
      { 'X-OpenPDF-Provider': id }, '/api/translate'));
    expect(translated.status).toBe(401);
    const reviewed = await review(request({ model: input.model, consent: true, sourceText: 'Hello', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XkAAAAASUVORK5CYII=' },
      { 'X-OpenPDF-Provider': id }, '/api/translation-review'));
    expect(reviewed.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
  });
  it('blocks cross-site credential writes before session or database access', async () => {
    const response = await POST(request(input, { origin: 'https://evil.example' }));
    expect(response.status).toBe(403); expect(session).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
  });
  it('takes ownership from the session when saving and rejects unauthenticated deletes', async () => {
    query.mockResolvedValue([row]);
    const response = await POST(request({ ...input, owner_id: 'owner-B' }));
    expect(response.status).toBe(201); expect(query.mock.calls[0]).toContain('owner-A');
    expect(JSON.stringify(await response.json())).not.toContain(input.apiKey);
    session.mockRejectedValue(new TranslationError('login_required', 401));
    expect((await DELETE(request({ id }))).status).toBe(401);
  });
  it('redacts unexpected database failures in responses', async () => {
    query.mockRejectedValue(new Error(`postgres password ${input.apiKey}`));
    const response = await POST(request(input));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'account_unavailable' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
