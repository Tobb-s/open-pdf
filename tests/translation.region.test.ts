import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateRegionImage, validateRegionReview, validateRegionResult, MAX_REVIEW_BODY_BYTES } from '@/lib/translation/review-contract';
import { reviewRegionWithProvider } from '@/lib/translation/review-provider';
import { regionGeometry } from '@/lib/translation/region';
import { POST } from '@/app/api/translation-review/route';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XkAAAAASUVORK5CYII=';
const input = { model: 'gpt-4.1-mini', image, sourceText: 'Growth in 1983.', consent: true as const };
const result = { text: 'Growth in 1985.', uncertain: false };
const response = () => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
const request = (body: unknown = input, headers: Record<string, string> = {}) => new Request('https://test.example/api/translation-review', {
  method: 'POST', headers: { origin: 'https://test.example', 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-test-key', ...headers },
  body: JSON.stringify(body),
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('regional review bounds and data contract', () => {
  it('accepts inline PNG and strips unknown fields/credentials', () => {
    expect(validateRegionReview({ ...input, key: 'secret', pdf: 'bytes', provider: 'foreign' })).toEqual(input);
    expect(validateRegionImage(image)).toBe(image);
  });
  it.each(['https://evil.example/image.png', 'file:///private.png', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,AAAA', image + '\n', image.replace('base64,', 'base64,!!!')])('rejects URL or invalid image %#', value => {
    expect(() => validateRegionImage(value)).toThrow('invalid_region');
  });
  it('rejects huge dimensions even for tiny compressed input', () => {
    const bytes = Buffer.from(image.slice(22), 'base64'); bytes.writeUInt32BE(2001, 16);
    expect(() => validateRegionImage('data:image/png;base64,' + bytes.toString('base64'))).toThrow('invalid_region');
  });
  it.each([null, { ...input, consent: false }, { ...input, model: '' }, { ...input, sourceText: 'x'.repeat(12001) }])('rejects invalid request %#', value => {
    expect(() => validateRegionReview(value)).toThrow();
  });
  it.each([{}, { text: '', uncertain: false }, { text: 'Reading', uncertain: 'false' }, { text: 'x'.repeat(12001), uncertain: true }])('rejects invalid output %#', value => {
    expect(() => validateRegionResult(value)).toThrow('invalid_response');
  });
  it('does not infer certainty or replace illegible content', () => {
    expect(validateRegionResult({ text: ' [illegible] ', uncertain: true, unexpected: 'discard' }))
      .toEqual({ text: '[illegible]', uncertain: true });
  });
  it.each(['Text \u0003 symbol', 'Text \u0000', '\ud800'])('rejects control characters and broken Unicode %#', text => {
    expect(() => validateRegionResult({ text, uncertain: true })).toThrow('invalid_response');
  });
  it('pads crop within the viewport and bounds pixel allocations', () => {
    const geometry = regionGeometry({ width: 1000, height: 2000 }, { x: 0, y: 0, width: 1000, height: 2000 });
    expect(geometry.x).toBe(0); expect(geometry.y).toBe(0);
    expect(Math.ceil(geometry.width * geometry.scale) * Math.ceil(geometry.height * geometry.scale)).toBeLessThanOrEqual(3_000_000);
    expect(Math.max(geometry.width, geometry.height) * geometry.scale).toBeLessThan(2000);
  });
  it.each([{ x: NaN, y: 1, width: 10, height: 10 }, { x: 100, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: 0, height: 1 }])('rejects invalid/off-page geometry %#', box => {
    expect(() => regionGeometry({ width: 100, height: 100 }, box)).toThrow('invalid_region');
  });
});
describe('regional vision transport and route', () => {
  it('uses one Responses call, no storage/tools, high-detail image and separate untrusted reference', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    expect(await reviewRegionWithProvider(input, 'test-key', new AbortController().signal, fetcher)).toEqual(result);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]; expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options!.redirect).toBe('error'); expect(options!.cache).toBe('no-store');
    const body = JSON.parse(options!.body as string);
    expect(body.store).toBe(false); expect(body.tools).toBeUndefined();
    expect(body.input[0].content[1]).toEqual({ type: 'input_image', image_url: image, detail: 'high' });
    expect(body.instructions).toContain('untrusted document DATA'); expect(body.instructions).toContain('Do not translate');
  });
  it.each([401, 403, 429, 400, 500])('maps HTTP %i safely without retrying', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('PRIVATE BODY', { status }));
    await expect(reviewRegionWithProvider(input, 'key', new AbortController().signal, fetcher))
      .rejects.toThrow(status === 429 ? 'provider_quota' : [401, 403].includes(status) ? 'provider_auth' : 'provider_error');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { status: 'incomplete', output: [] }, { status: 'completed', output: [{ content: [{ type: 'refusal' }] }] },
    { status: 'completed', output: [{ content: [{ type: 'output_text', text: 'broken JSON' }] }] },
  ])('rejects incomplete/refused/invalid response %#', async data => {
    await expect(reviewRegionWithProvider(input, 'key', new AbortController().signal,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(data)))).rejects.toThrow('invalid_response');
  });
  it('maps abort without returning exception/key material', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(reviewRegionWithProvider(input, 'PRIVATE KEY', controller.signal,
      vi.fn<typeof fetch>().mockRejectedValue(new Error('PRIVATE KEY')))).rejects.toThrow('cancelled_or_timeout');
  });
  it('requires a caller key and never uses a server key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'server-secret'); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await POST(request(input, { Authorization: '' }))).status).toBe(401); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects foreign origins and missing image consent before provider access', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await POST(request(input, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await POST(request({ ...input, consent: false }))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds request streams and keeps route errors free of private provider content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('PRIVATE PROVIDER BODY', { status: 500 })));
    const failed = await POST(request()); expect(await failed.json()).toEqual({ error: 'provider_error' });
    const huge = await POST(request({ ...input, extra: 'x'.repeat(MAX_REVIEW_BODY_BYTES) }));
    expect(huge.status).toBe(413); expect(huge.headers.get('cache-control')).toBe('no-store');
  });
  it('returns validated results and releases capacity after a failed call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response()).mockRejectedValueOnce(new Error('private')));
    expect((await POST(request())).status).toBe(502);
    for (let i = 0; i < 6; i++) expect(await (await POST(request())).json()).toEqual(result);
  });
  it('rejects a fifth simultaneous request and recovers capacity after completion', async () => {
    const finish: (() => void)[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => finish.push(() => resolve(response())))));
    const calls = Array.from({ length: 4 }, () => POST(request()));
    await vi.waitFor(() => expect(finish).toHaveLength(4));
    expect((await POST(request())).status).toBe(429);
    finish.forEach(done => done()); expect((await Promise.all(calls)).every(r => r.status === 200)).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response()));
    expect((await POST(request())).status).toBe(200);
  });
});
