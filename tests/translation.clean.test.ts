import { describe, expect, it, vi, afterEach } from 'vitest';
import { linkRecoveredReferences, validateCleanRequest, validateCleanResult, type CleanElement, type CleanPage } from '@/lib/translation/clean-contract';
import { CLEAN_HEIGHT, CLEAN_MARGIN, CLEAN_WIDTH, planCleanDocument } from '@/lib/translation/clean-document';
import { cleanWithProvider } from '@/lib/translation/clean-provider';
import { POST } from '@/app/api/translation-clean/route';
import { cleanVerificationBox, cleanVerificationMask, verifyCleanReading } from '@/lib/translation/clean-verification';
import { keepCleanTitlesTogether } from '@/lib/translation/clean-order';
import { cleanTextGroups } from '@/lib/translation/clean-groups';
import { plainCleanText } from '@/lib/translation/clean-text';
import { MAX_ANALYSIS_PAGES, selectedPageNumbers } from '@/lib/translation/scope';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XkAAAAASUVORK5CYII=';
const box = { x: 10, y: 20, width: 300, height: 100 };
const reference = [{ id: 'p1_b1', text: 'Growth in 1983.', ...box }];
const element = (patch: Partial<CleanElement> = {}): CleanElement => ({ kind: 'paragraph', ids: ['p1_b1'], text: 'Growth in 1983.', box,
  noiseReason: 'none', uncertain: false, ...patch });
const input = () => ({ model: 'gpt-6-luna', image, blocks: reference, consent: true as const });
const response = () => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ elements: [element()] }) }] }] });
const page = (): CleanPage => ({ number: 1, width: 400, height: 400, reference: structuredClone(reference),
  elements: [{ ...element(), translated: 'Crecimiento en 1983.' }] });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('clean structure contract', () => {
  it('accepts a bounded PNG and strips unrelated request data', () => expect(validateCleanRequest({ ...input(), secret: 'never forwarded' })).toEqual(input()));
  it.each([null, { ...input(), consent: false }, { ...input(), model: '' }, { ...input(), image: 'https://private/image' },
    { ...input(), blocks: [...reference, ...reference] }, { ...input(), blocks: [{ ...reference[0], width: Infinity }] },
    { ...input(), blocks: [{ ...reference[0], text: 'a'.repeat(22001) }] }])('rejects invalid request %#', v => expect(() => validateCleanRequest(v)).toThrow());
  it('requires exact ID accounting', () => {
    expect(validateCleanResult({ elements: [element()] }, reference)).toEqual([element()]);
    for (const elements of [[], [element({ ids: [] })], [element({ ids: ['unknown'] })], [element(), element()]]) {
      expect(() => validateCleanResult({ elements }, reference)).toThrow('invalid_response');
    }
  });
  it('retains the transcription and reason for excluded page furniture', () => {
    const e = element({ kind: 'noise', noiseReason: 'page_number', text: '12' });
    expect(validateCleanResult({ elements: [e] }, reference)[0]).toEqual(e);
  });
  it('records a non-text scan speck without inventing characters or erasing an OCR reference', () => {
    const e = element({ ids: [], kind: 'noise', noiseReason: 'scan_mark', text: '' });
    expect(validateCleanResult({ elements: [e] }, [])).toEqual([e]);
    expect(() => validateCleanResult({ elements: [e] }, reference)).toThrow();
    expect(() => validateCleanResult({ elements: [{ ...e, ids: ['p1_b1'] }] }, reference)).toThrow();
  });
  it.each([element({ kind: 'noise' }), element({ noiseReason: 'running_header' }), element({ kind: 'noise', noiseReason: 'page_number', uncertain: true }),
    element({ box: { ...box, x: 1000 } }), element({ text: '' }), element({ text: '\ud800' })])('rejects inconsistent or unsafe elements %#', e => {
    expect(() => validateCleanResult({ elements: [e] }, reference)).toThrow('invalid_response');
  });
  it('cannot hide a paragraph in a noise classification or silently summarize prose', () => {
    const blocks = [{ ...reference[0], text: 'Long genuine paragraph. '.repeat(20) }];
    expect(() => validateCleanResult({ elements: [element({ kind: 'noise', noiseReason: 'scan_mark' })] }, blocks)).toThrow();
    expect(() => validateCleanResult({ elements: [element({ text: 'A summary.' })] }, blocks)).toThrow();
  });
  it.each(['Growth in 1985.', 'Growth in -1983.', 'Growth in 1983. [illegible]'])('flags numerical changes or illegibility, even if AI claims certainty: %s', text => {
    expect(validateCleanResult({ elements: [element({ text })] }, reference)[0].uncertain).toBe(true);
  });
  it('accounts for graph OCR in the intact figure, not duplicated translated labels', () => {
    const figure = element({ kind: 'figure', text: '' });
    expect(validateCleanResult({ elements: [figure] }, reference)).toEqual([figure]);
  });
  it('protects catalog identifiers even when the proposed noise text disguises the OCR identifier', () => {
    for (const text of ['WPS 1807', 'ISBN 123', 'ISSN 456', 'DOI 10.123']) {
      const blocks = [{ ...reference[0], text }];
      expect(() => validateCleanResult({ elements: [element({ kind: 'noise', text: 'scan', noiseReason: 'scan_mark' })] }, blocks)).toThrow('invalid_response');
    }
  });
  it('links a uniquely recovered full paragraph without concealing real coverage errors', () => {
    const text = 'The economy depends on investment and productive capabilities over a long period.';
    const blocks = [{ ...reference[0], text }];
    const result = linkRecoveredReferences({ elements: [element({ text, ids: [] })] }, blocks);
    expect(validateCleanResult(result, blocks)[0].ids).toEqual(['p1_b1']);
    expect(() => validateCleanResult(linkRecoveredReferences({ elements: [element({ text: 'A summary.', ids: [] })] }, blocks), blocks)).toThrow();
    expect(() => validateCleanResult(linkRecoveredReferences({ elements: [element({ text, ids: [] }), element({ text, ids: [] })] }, blocks), blocks)).toThrow();
  });
});
describe('new flowing document layout', () => {
  const measure = (text: string) => text.length * 6;
  it('places a figure between exactly the same neighbors, even after text spills onto later pages', () => {
    const p = page(); p.elements[0].translated = 'Primero. '.repeat(1200);
    p.reference.push({ id: 'img', text: 'Chart labels', ...box }, { id: 'last', text: 'Last paragraph.', ...box });
    p.elements.push({ ...element({ ids: ['img'], kind: 'figure', text: '', box: { ...box, height: 300 } }), translated: '' },
      { ...element({ ids: ['last'], text: 'Last paragraph.' }), translated: 'Último párrafo.' });
    const copy = JSON.stringify(p), result = planCleanDocument([p], measure);
    const fig = result.placements.findIndex(x => x.text === undefined);
    expect(result.pageCount).toBeGreaterThan(1); expect(fig).toBeGreaterThan(1);
    expect(result.placements[fig - 1].element).toBe(0); expect(result.placements[fig + 1].element).toBe(2);
    expect(result.placements[fig].sheet).toBeGreaterThan(0); expect(JSON.stringify(p)).toBe(copy);
    expect(result.placements.filter(x => x.element === 0).map(x => x.text).join(' ').trim()).toBe(p.elements[0].translated.trim());
    expect(result.placements.every(x => x.y >= CLEAN_MARGIN && x.y + (x.height ?? 16.8) <= CLEAN_HEIGHT - CLEAN_MARGIN)).toBe(true);
    expect(result.placements[fig].x + result.placements[fig].width!).toBeLessThanOrEqual(CLEAN_WIDTH - CLEAN_MARGIN + .1);
  });
  it('flows across source-page boundaries without blank original plates or technical labels', () => {
    const p = page(), q = { ...page(), number: 2 };
    const result = planCleanDocument([p, q], measure);
    expect(result.pageCount).toBe(1); expect(result.sourcePages).toEqual([1, 1]);
    expect(result.placements.map(x => x.text)).toEqual(['Crecimiento en 1983.', 'Crecimiento en 1983.']);
  });
  it('rejects a recovered heading duplicated inside the neighboring paragraph', () => {
    const p = page(); p.elements[0].text += ' Section heading recovered'; p.reference[0].text = p.elements[0].text;
    p.elements.push({ ...element({ kind: 'heading', ids: [], text: 'Section heading recovered' }), translated: 'Título recuperado' });
    expect(() => planCleanDocument([p], measure)).toThrow('clean_uncertain');
  });
  it('does not publish a translation that introduced an illegible placeholder', () => {
    const p = page(); p.elements[0].translated = '[ilegible]';
    expect(() => planCleanDocument([p], measure)).toThrow('clean_uncertain');
  });
  it('keeps a short translated caption with its figure when both fit on one new page', () => {
    const p = page(); p.elements[0].translated = 'Texto. '.repeat(450);
    p.reference.push({ ...reference[0], id: 'caption', text: 'Figure 2: Chart title' });
    p.elements.push({ ...element({ ids: ['caption'], text: 'Figure 2: Chart title' }), translated: 'Figura 2: Título' },
      { ...element({ ids: [], kind: 'figure', text: '', box: { x: 100, y: 100, width: 500, height: 500 } }), translated: '' });
    const positions = planCleanDocument([p], measure).placements;
    expect(positions.at(-2)!.element).toBe(1); expect(positions.at(-1)!.sheet).toBe(positions.at(-2)!.sheet);
  });
  it.each([0, MAX_ANALYSIS_PAGES + 1])('rejects selection length %i', length => expect(() => planCleanDocument(Array.from({ length }, (_, i) => ({ ...page(), number: i + 1 })), measure)).toThrow());
  it('accepts a later inclusive range with physical page references', () => {
    const pages = Array.from({ length: 31 }, (_, i) => ({ ...page(), number: i + 20 }));
    const result = planCleanDocument(pages, measure);
    expect(result.placements.map(p => p.page)).toEqual(selectedPageNumbers(80, { mode: 'range', from: 20, to: 50 }));
    expect(result.sourcePages).toHaveLength(31);
  });
  it('rejects uncertainty and missing translations rather than publishing an incomplete document', () => {
    const p = page(); p.elements[0].uncertain = true;
    expect(() => planCleanDocument([p], measure)).toThrow('clean_uncertain');
    p.elements[0].uncertain = false; p.elements[0].translated = '';
    expect(() => planCleanDocument([p], measure)).toThrow('layout_issues');
  });
  it('joins a paragraph cut across source pages before translation, but never crosses a figure', () => {
    const p = page(), q = { ...page(), number: 2 };
    p.elements[0].text = 'The future Nobel'; p.reference[0].text = p.elements[0].text;
    q.elements[0].text = 'Prize Winner studied growth.'; q.reference[0].text = q.elements[0].text;
    const groups = cleanTextGroups([p, q]);
    expect(groups).toHaveLength(1); expect(groups[0].text).toBe('The future Nobel Prize Winner studied growth.');
    expect(() => planCleanDocument([p, q], measure)).toThrow('layout_issues');
    p.elements[0].translated = 'El futuro ganador del Premio Nobel estudió el crecimiento.';
    p.elements[0].translatedSource = groups[0].text;
    expect(planCleanDocument([p, q], measure).placements.map(p => p.text).join(' ')).toBe(p.elements[0].translated);
    q.elements.unshift({ ...element({ kind: 'figure', ids: [], text: '' }), translated: '' });
    expect(cleanTextGroups([p, q])).toHaveLength(2);
  });
});
describe('independent checks for suspicious readings', () => {
  it('removes introduced prose emphasis, not author asterisks or mathematical multiplication', () => {
    expect(plainCleanText('En *Foreign Affairs*, afirma **Las etapas**.', 'In Foreign Affairs, he states The Stages.')).toBe('En Foreign Affairs, afirma Las etapas.');
    expect(plainCleanText('x*y*z', 'x × y × z')).toBe('x*y*z');
    expect(plainCleanText('*nota original*', '*source note*')).toBe('*nota original*');
  });
  it('keeps a connected title and subtitle together without moving an intervening image', () => {
    const title = element({ kind: 'heading', text: 'Title', box: { x: 70, y: 300, width: 400, height: 35 } });
    const subtitle = element({ kind: 'heading', text: 'Subtitle', box: { x: 70, y: 350, width: 300, height: 60 } });
    const sidebar = element({ text: 'Sidebar', box: { x: 600, y: 300, width: 200, height: 80 } });
    expect(keepCleanTitlesTogether([title, sidebar, subtitle])).toEqual([title, subtitle, sidebar]);
    const image = element({ kind: 'figure', text: '' });
    expect(keepCleanTitlesTogether([title, image, subtitle])).toEqual([title, image, subtitle]);
  });
  it('pads the union of AI and OCR bounds so a guessed crop cannot cut the final source line', () => {
    const p = page(); p.elements[0].box = { x: 10, y: 20, width: 300, height: 10 };
    const b = cleanVerificationBox(p, 0); expect(b.y + b.height).toBe(128); expect(b.x).toBe(2);
  });
  it('masks separate neighboring titles even if their OCR ID was merged into the target paragraph', () => {
    const p = page(), b = { x: 10, y: 140, width: 200, height: 20 };
    p.elements.push({ ...element({ kind: 'heading', ids: [], text: 'Section heading', box: b }), translated: '' });
    expect(cleanVerificationMask(p, 0)).toContainEqual(b);
  });
  it('accepts a matching unambiguous crop reading with only one extra call', async () => {
    const read = vi.fn().mockResolvedValue({ text: 'Growth\nin 1983.', uncertain: false });
    expect(await verifyCleanReading('Growth in 1983.', read)).toBe('Growth\nin 1983.'); expect(read).toHaveBeenCalledTimes(1);
  });
  it('requires two agreeing readings before correcting a number from the initial proposal', async () => {
    const read = vi.fn().mockResolvedValue({ text: 'Growth in 1985.', uncertain: false });
    expect(await verifyCleanReading('Growth in 1983.', read)).toBe('Growth in 1985.'); expect(read).toHaveBeenCalledTimes(2);
  });
  it('does not guess when the crop readings disagree', async () => {
    const read = vi.fn().mockResolvedValueOnce({ text: 'Growth in 1985.', uncertain: false }).mockResolvedValueOnce({ text: 'Growth in 1986.', uncertain: false });
    expect(await verifyCleanReading('Growth in 1983.', read)).toBeUndefined(); expect(read).toHaveBeenCalledTimes(2);
  });
  it('accepts a second crop reading agreeing with the original proposal across a printed hyphenated line wrap', async () => {
    const read = vi.fn().mockResolvedValueOnce({ text: 'Long-term output growth in 1985.', uncertain: false })
      .mockResolvedValueOnce({ text: 'Long-\nterm output growth in 1983.', uncertain: false });
    expect(await verifyCleanReading('Long-term output growth in 1983.', read)).toBe('Long-term output growth in 1983.');
  });
  it('does not spend a second call on an illegible crop or retry a transport error', async () => {
    const read = vi.fn().mockResolvedValue({ text: '[illegible]', uncertain: true });
    expect(await verifyCleanReading('Growth in 1983.', read)).toBeUndefined(); expect(read).toHaveBeenCalledTimes(1);
    const failed = vi.fn().mockRejectedValue(new Error('provider_unreachable'));
    await expect(verifyCleanReading('Growth', failed)).rejects.toThrow('provider_unreachable'); expect(failed).toHaveBeenCalledTimes(1);
  });
  it('preserves real paragraph breaks when an OCR block had merged adjacent paragraphs', () => {
    const a = 'The economy depends on investment and productive capabilities over a long period.';
    const b = 'Saving and infrastructure shape productive capacity through several complementary mechanisms.';
    const blocks = [{ ...reference[0], text: a + ' ' + b }];
    const linked = linkRecoveredReferences({ elements: [element({ text: a }), element({ text: b, ids: [] })] }, blocks);
    expect(validateCleanResult(linked, blocks)[0].text).toBe(a + '\n\n' + b);
  });
  it('links an OCR-merged lead-in preceding a separately recovered table caption', () => {
    const a = 'Table 3 shows the results of including a constant in these country by country regressions.';
    const b = 'Table 3: Results of regressing growth on investment with a constant, country by country.';
    const blocks = [{ ...reference[0], text: a + ' ' + b }];
    const linked = linkRecoveredReferences({ elements: [element({ text: a, ids: [] }), element({ text: b })] }, blocks);
    expect(validateCleanResult(linked, blocks)[0]).toMatchObject({ text: a + '\n\n' + b, ids: ['p1_b1'] });
    expect(() => validateCleanResult(linkRecoveredReferences({ elements: [element({ text: 'Unrelated prose.', ids: [] }), element({ text: b })] }, blocks), blocks)).toThrow();
  });
});
describe('page vision transport and credential isolation', () => {
  it('makes one strict-schema Responses call without storage, tools or PDF upload', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    expect(await cleanWithProvider(input(), 'synthetic', new AbortController().signal, fetcher)).toEqual([element()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.store).toBe(false); expect(body.tools).toBeUndefined(); expect(body.text.format.strict).toBe(true);
    expect(body.instructions).toContain('untrusted DATA'); expect(body.input[0].content[1].image_url).toBe(image);
  });
  it.each([401, 429, 500])('does not retry HTTP %i or leak response content', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('PRIVATE', { status }));
    await expect(cleanWithProvider(input(), 'synthetic', new AbortController().signal, fetcher)).rejects.toThrow(status === 401 ? 'provider_auth' : status === 429 ? 'provider_quota' : 'provider_error');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects a truncated successful response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'incomplete', output: [] }));
    await expect(cleanWithProvider(input(), 'synthetic', new AbortController().signal, fetcher)).rejects.toThrow('invalid_response');
  });
  it('never uses the development key as a public-route fallback', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'server-secret-never-used'); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const request = new Request('https://example.test/api/translation-clean', { method: 'POST',
      headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' }, body: JSON.stringify(input()) });
    const response = await POST(request); expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: 'key_required' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects a foreign origin before reading image data', async () => {
    const request = new Request('https://example.test/api/translation-clean', { method: 'POST', headers: { Origin: 'https://evil.test' }, body: '{}' });
    const response = await POST(request); expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'origin_rejected' });
  });
});
