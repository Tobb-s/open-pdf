import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { session, load } = vi.hoisted(() => ({ session: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/account/auth', () => ({ requireAccount: session }));
vi.mock('@/lib/account/store', () => ({ loadProvider: load }));
import { POST } from '@/app/api/models/route';
import { modelKind, parseModels } from '@/lib/openai/models';
import { translateWithProvider } from '@/lib/translation/provider';
import { TranslationError } from '@/lib/translation/contracts';

const id = '12345678-1234-1234-1234-123456789abc', key = 'synthetic-private-key-1234';
const fetcher = vi.fn();
function request(headers: Record<string, string> = { Authorization: `Bearer ${key}` }, body = '{"provider":"openai"}') {
  return new Request('https://openpdf.test/api/models', { method: 'POST',
    headers: { origin: 'https://openpdf.test', 'Content-Type': 'application/json', ...headers }, body });
}
beforeEach(() => {
  session.mockReset().mockResolvedValue({ ownerId: 'owner-A' });
  load.mockReset().mockResolvedValue({ provider: 'openai', model: 'gpt-4.1-mini', apiKey: key });
  fetcher.mockReset().mockResolvedValue(Response.json({ data: [{ id: 'gpt-6-luna', owner: 'private-metadata' }, { id: 'gpt-image-2' }] }));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('private OpenAI model catalog', () => {
  it('retains every model ID, deduplicates, sorts Luna first and strips provider metadata', () => {
    expect(parseModels({ data: [{ id: 'gpt-image-2', secret: key }, { id: 'gpt-6-luna' }, { id: 'gpt-6-luna' }, { id: 'future-text' }] }))
      .toEqual([{ id: 'gpt-6-luna', kind: 'text' }, { id: 'future-text', kind: 'text' }, { id: 'gpt-image-2', kind: 'specialized' }]);
    expect(modelKind('gpt-4.1-mini')).toBe('text'); expect(modelKind('gpt-4o')).toBe('text');
    expect(modelKind('gpt-3.5-turbo')).toBe('legacy'); expect(modelKind('gpt-4')).toBe('legacy');
    expect(modelKind('text-embedding-3-small')).toBe('specialized'); expect(modelKind('gpt-audio')).toBe('specialized');
  });
  it.each([null, {}, { data: {} }, { data: [null] }, { data: [{ id: '<script>' }] }, { data: Array(5001).fill({ id: 'x' }) }])
    ('rejects invalid or excessive catalogs %#', value => expect(() => parseModels(value)).toThrow('invalid_response'));
  it('uses only the explicit guest key, fixed endpoint, no-store and redacted metadata', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'global-owner-key');
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const text = JSON.stringify(await response.json()); expect(text).not.toContain(key); expect(text).not.toContain('private-metadata');
    expect(fetcher).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.objectContaining({
      redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${key}` },
    }));
    expect(session).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
  });
  it('resolves saved credentials only for the authenticated owner and does not require their default model', async () => {
    expect((await POST(request({ 'X-OpenPDF-Provider': id }))).status).toBe(200);
    expect(load).toHaveBeenCalledWith('owner-A', id);
  });
  it('rejects a foreign provider before contacting OpenAI', async () => {
    load.mockRejectedValue(new TranslationError('provider_not_found', 404));
    const response = await POST(request({ 'X-OpenPDF-Provider': id }));
    expect(response.status).toBe(404); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects expired sessions before database or provider access', async () => {
    session.mockRejectedValue(new TranslationError('login_required', 401));
    expect((await POST(request({ 'X-OpenPDF-Provider': id }))).status).toBe(401);
    expect(load).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects a saved Gemini key rather than sending it to OpenAI', async () => {
    load.mockResolvedValue({ provider: 'gemini', model: 'gemini-2.5-flash', apiKey: key });
    expect((await POST(request({ 'X-OpenPDF-Provider': id }))).status).toBe(409); expect(fetcher).not.toHaveBeenCalled();
  });
  it('never falls back to the operator key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'global-owner-key');
    expect((await POST(request({}))).status).toBe(401); expect(fetcher).not.toHaveBeenCalled();
  });
  it('blocks cross-site, invalid, oversized and unsupported-provider requests before outbound access', async () => {
    expect((await POST(request({ origin: 'https://evil.test' }))).status).toBe(403);
    expect((await POST(request({}, '{invalid'))).status).toBe(400);
    expect((await POST(request({}, 'x'.repeat(101)))).status).toBe(413);
    expect((await POST(request({}, '{"provider":"compatible","baseUrl":"https://evil.test"}'))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([[401, 'provider_auth'], [403, 'provider_auth'], [429, 'provider_quota'], [500, 'provider_error']])
    ('redacts provider failure %s', async (status, error) => {
      fetcher.mockResolvedValue(new Response(key, { status: status as number }));
      const response = await POST(request()); expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error });
    });
  it('redacts malformed response and transport exceptions', async () => {
    fetcher.mockResolvedValue(new Response('{bad'));
    expect(await (await POST(request())).json()).toEqual({ error: 'invalid_response' });
    fetcher.mockRejectedValue(new Error(key));
    expect(await (await POST(request())).json()).toEqual({ error: 'provider_unreachable' });
  });
  it('keeps GPT-6 Luna on Responses with strict output and no storage or unsupported sampling parameters', async () => {
    const translated = { translations: [{ id: 'x', text: 'Hola' }] };
    fetcher.mockResolvedValue(Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(translated) }] }] }));
    expect(await translateWithProvider({ provider: 'openai', model: 'gpt-6-luna', glossary: '', consent: true,
      segments: [{ id: 'x', text: 'Hello' }] }, key, new AbortController().signal)).toEqual(translated.translations);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-6-luna'); expect(body.store).toBe(false); expect(body.text.format.strict).toBe(true);
    expect(body.temperature).toBeUndefined(); expect(body.top_p).toBeUndefined();
  });
});
