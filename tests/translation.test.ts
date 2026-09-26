import { describe, expect, it, vi, afterEach } from 'vitest';
import { batches, validateRequest, validateTranslations, type TranslationRequest } from '@/lib/translation/contracts';
import { fitBlock, groupRuns, isVerticalOcrRun } from '@/lib/translation/layout';
import { providerUrl, readBounded, translateWithProvider } from '@/lib/translation/provider';
import { POST } from '@/app/api/translate/route';
const input: TranslationRequest = { provider: 'openai', model: 'gpt-4.1-mini', glossary: '', consent: true,
  segments: [{ id: 'p1_b1', text: 'Economic growth and capital.' }] };
const result = { translations: [{ id: 'p1_b1', text: 'Crecimiento económico y capital.' }] };
const response = () => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
afterEach(() => vi.unstubAllGlobals());
describe('translation contract', () => {
  it('keeps only allowed fields and never carries a credential', () => {
    expect(validateRequest({ ...input, key: 'secret', pdf: 'bytes' })).toEqual(input);
  });
  it.each([null, {}, { ...input, consent: false }, { ...input, model: '' }, { ...input, segments: [] },
    { ...input, segments: [...input.segments, ...input.segments] }, { ...input, segments: [{ id: 'x', text: ' ' }] },
    { ...input, glossary: 'a'.repeat(3001) }, { ...input, segments: [{ id: 'x', text: 'a'.repeat(12001) }] }])('rejects malformed request %#', value => {
    expect(() => validateRequest(value)).toThrow();
  });
  it.each([{}, { translations: [] }, { translations: [{ id: 'foreign', text: 'Hola' }] },
    { translations: [{ id: 'p1_b1', text: '' }] }, { translations: [...result.translations, ...result.translations] }])('rejects incomplete or wrong output %#', v => {
    expect(() => validateTranslations(v, input.segments)).toThrow();
  });
  it('restores source order', () => {
    expect(validateTranslations({ translations: [{ id: 'b', text: 'B' }, { id: 'a', text: 'A' }] }, [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }]).map(s => s.id)).toEqual(['a', 'b']);
  });
  it('bounds batches without dropping blocks', () => {
    const source = Array.from({ length: 201 }, (_, i) => ({ id: `${i}`, text: 'a'.repeat(310) }));
    const groups = batches(source);
    expect(groups.flat()).toEqual(source);
    expect(groups.every(g => g.length <= 80 && g.reduce((n, s) => n + s.text.length, 0) <= 12000)).toBe(true);
  });
});
describe('provider and route security', () => {
  it.each(['http://localhost', 'https://127.0.0.1', 'https://evil.example', 'https://openrouter.ai.evil/api/v1',
    'https://openrouter.ai/api/v1?key=secret', 'https://user:pass@openrouter.ai/api/v1'])('rejects arbitrary endpoint %s', baseUrl => {
    expect(() => providerUrl({ ...input, provider: 'compatible', baseUrl })).toThrow('endpoint_not_allowed');
  });
  it('uses the Gemini compatibility endpoint', () => expect(providerUrl({ ...input, provider: 'gemini' })).toContain('generativelanguage.googleapis.com'));
  it('supports exact operator allowlisting', () => expect(providerUrl({ ...input, provider: 'compatible', baseUrl: 'https://vendor.example/v1/' }, 'https://vendor.example/v1')).toBe('https://vendor.example/v1/chat/completions'));
  it('does not follow redirects and disables OpenAI storage', async () => {
    const fetcher = vi.fn().mockResolvedValue(response());
    expect(await translateWithProvider(input, 'test-only-key', new AbortController().signal, { fetch: fetcher })).toEqual(result.translations);
    const init = fetcher.mock.calls[0][1];
    expect(init.redirect).toBe('error'); expect(init.cache).toBe('no-store');
    expect(JSON.parse(init.body).store).toBe(false);
    expect(init.body).not.toContain('test-only-key');
  });
  it.each([401, 403, 429, 500])('does not echo provider error body or retry (%s)', async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response('secret provider detail', { status }));
    await expect(translateWithProvider(input, 'key', new AbortController().signal, { fetch: fetcher })).rejects.not.toThrow('secret');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects truncated completions even when JSON happens to parse', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: 'incomplete', output: [] }));
    await expect(translateWithProvider(input, 'key', new AbortController().signal, { fetch: fetcher })).rejects.toThrow('invalid_response');
  });
  it('limits bodies without content-length', async () => {
    await expect(readBounded(new Response('abcdef').body, 5)).rejects.toThrow('payload_too_large');
  });
  const request = (overrides: Record<string, string> = {}, body = input) => new Request('https://openpdf.example/api/translate', {
    method: 'POST', headers: { Origin: 'https://openpdf.example', Authorization: 'Bearer test-only-key', 'Content-Type': 'application/json', ...overrides }, body: JSON.stringify(body),
  });
  it('refuses cross-origin requests before contacting providers', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await POST(request({ Origin: 'https://evil.example' }))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not fall back to the developer environment key', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await POST(request({ Authorization: '' }))).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires consent and sends no-store on error', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const r = await POST(request({}, { ...input, consent: false } as unknown as TranslationRequest));
    expect(r.status).toBe(400); expect(r.headers.get('cache-control')).toBe('no-store'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns validated output with no-store', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    const r = await POST(request()); expect(r.status).toBe(200); expect(await r.json()).toEqual(result);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});
describe('layout safety', () => {
  const run = (text: string, x: number, y: number, width = 100) => ({ text, x, y, width, height: 12, size: 12, font: 'Times' });
  it('keeps columns and table gaps apart', () => {
    const blocks = groupRuns([run('Left column', 20, 20), run('Right column', 300, 20), run('Left second', 20, 35), run('Right second', 300, 35)], 1);
    expect(blocks).toHaveLength(2); expect(blocks[0].source).toBe('Left column Left second');
  });
  it('does not scramble OCR words with different ascender heights', () => {
    const blocks = groupRuns([run('growth', 60, 19, 40), run('Economic', 0, 21, 55), run('depends', 105, 20, 45)], 1);
    expect(blocks[0].source).toBe('Economic growth depends');
  });
  it('keeps recognized words and tiny punctuation in one reading line', () => {
    const blocks = groupRuns([
      { ...run('growth', 68, 21, 39), line: 1, height: 8, size: 7 },
      { ...run('a', 58, 24, 5), line: 1, height: 5, size: 4 },
      { ...run('Economic', 0, 20, 54), line: 1, height: 10, size: 9 },
      { ...run('=', 111, 26, 8), line: 1, height: 2, size: 1.5 },
    ], 1);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toBe('Economic a growth =');
    expect(blocks[0].size).toBeCloseTo(7 / 0.75);
  });
  it('does not merge different recognition lines despite overlapping ink boxes', () => {
    const blocks = groupRuns([
      { ...run('First', 0, 20, 40), line: 1 },
      { ...run('Second', 45, 22, 50), line: 2 },
    ], 1);
    expect(blocks.map(b => b.source)).toEqual(['First', 'Second']);
  });
  it('retains column gaps even when OCR assigns both columns the same line', () => {
    const blocks = groupRuns([
      { ...run('Left', 0, 20, 40), line: 1 },
      { ...run('Right', 300, 20, 40), line: 1 },
    ], 1);
    expect(blocks.map(b => b.source)).toEqual(['Left', 'Right']);
  });
  it('identifies sideways words without removing narrow upright letters or native text', () => {
    expect(isVerticalOcrRun({ ...run('Authorized', 8, 20, 9), height: 47, line: 1 })).toBe(true);
    expect(isVerticalOcrRun({ ...run('I', 8, 20, 2), line: 1 })).toBe(false);
    expect(isVerticalOcrRun({ ...run('Authorized', 8, 20, 9), height: 47 })).toBe(false);
    expect(isVerticalOcrRun({ ...run('Economics', 50, 20, 70), line: 1 })).toBe(false);
  });
  it('invalid boxes do not distort recognition-line font metrics', () => {
    const blocks = groupRuns([
      { ...run('Good', 0, 20, 40), line: 1 },
      { ...run('bad', NaN, 20, 30), line: 1, size: 999 },
    ], 1);
    expect(blocks).toHaveLength(1); expect(blocks[0].source).toBe('Good');
    expect(blocks[0].size).toBe(16);
  });
  it('keeps separated paragraphs apart and gives stable unique ids', () => {
    const blocks = groupRuns([run('First', 20, 20), run('Next', 20, 100)], 2);
    expect(blocks.map(b => b.id)).toEqual(['p2_b1', 'p2_b2']);
  });
  it('does not clip a long unbreakable word', () => expect(fitBlock('a'.repeat(100), { x: 0, y: 0, width: 100, height: 12 }, 12, (s, size) => s.length * size / 2)).toBeNull());
  it('wraps and fits text without going below 7pt', () => {
    const fit = fitBlock('Uno dos tres cuatro cinco seis', { x: 0, y: 0, width: 90, height: 35 }, 12, (s, size) => s.length * size / 2);
    expect(fit).not.toBeNull(); expect(fit!.size).toBeGreaterThanOrEqual(7);
    expect(fit!.lines.every(l => l.length * fit!.size / 2 <= 90)).toBe(true);
  });
});

it.skipIf(process.env.LIVE_TRANSLATION_SMOKE !== '1')('live development-key smoke: synthetic text only', async () => {
  // Explicit opt-in only; never run on CI by default. Do not print environment or responses.
  process.loadEnvFile('.env.local');
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Development key unavailable');
  const translated = await translateWithProvider(input, key, AbortSignal.timeout(60_000));
  expect(translated[0].text.toLowerCase()).toContain('crecimiento');
  expect(translated[0].text.toLowerCase()).toContain('capital');
}, 70_000);
