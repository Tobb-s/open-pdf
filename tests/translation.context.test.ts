import { describe, expect, it } from 'vitest';
import { buildTranslationContext } from '@/lib/translation/context';
import { validateRequest, validateTranslationResult, type TranslationRequest } from '@/lib/translation/contracts';
import type { TranslationPage } from '@/lib/translation/layout';

const pages = (count = 10): TranslationPage[] => Array.from({ length: count }, (_, i) => ({
  number: i + 1, width: 400, height: 400, method: 'native', warnings: [], blocks: [{
    id: `p${i + 1}_b1`, source: `Source ${i + 1}`, translated: '', included: true,
    x: 0, y: 0, width: 100, height: 20, size: 12, font: 'Helvetica', lines: [],
  }],
}));
const input: TranslationRequest = { provider: 'openai', model: 'gpt-4.1-mini', glossary: 'capital = capital', consent: true,
  segments: [{ id: 'p5_b1', text: 'Source 5' }] };
describe('bounded translation context', () => {
  it('uses neighbors across page boundaries but never includes targets', () => {
    expect(buildTranslationContext(pages(), input.segments).map(c => [c.id, c.position]))
      .toEqual([['p3_b1', 'before'], ['p4_b1', 'before'], ['p6_b1', 'after'], ['p7_b1', 'after']]);
  });
  it('does not leak excluded source text or translations', () => {
    const document = pages(); document[3].blocks[0].included = false;
    document[3].blocks[0].source = 'PRIVATE SOURCE'; document[3].blocks[0].translated = 'PRIVATE TRANSLATION';
    const context = buildTranslationContext(document, input.segments);
    expect(JSON.stringify(context)).not.toContain('PRIVATE');
    expect(context.some(c => c.id === 'p4_b1')).toBe(false);
  });
  it('includes nearby accepted references and corrected translations in document order', () => {
    const document = pages();
    document[0].blocks[0].translated = 'Referencia previa'; document[1].blocks[0].translated = 'Capital corregido';
    document[3].blocks[0].translated = 'Corrección del usuario';
    const context = buildTranslationContext(document, input.segments);
    expect(context).toHaveLength(6);
    expect(context.slice(0, 2).map(c => c.position)).toEqual(['reference', 'reference']);
    expect(context.find(c => c.id === 'p4_b1')?.translation).toBe('Corrección del usuario');
    expect(context.find(c => c.id === 'p2_b1')?.translation).toBe('Capital corregido');
  });
  it('bounds long excerpts without truncating the original or the translation targets', () => {
    const document = pages();
    for (const page of document) {
      page.blocks[0].source = 'HEAD' + 's'.repeat(8000) + 'TAIL';
      page.blocks[0].translated = 'INICIO' + 't'.repeat(16000) + 'FIN';
    }
    const original = JSON.stringify(document);
    const context = buildTranslationContext(document, input.segments);
    expect(context.length).toBeLessThanOrEqual(6);
    expect(context.reduce((n, c) => n + c.text.length + (c.translation?.length ?? 0), 0)).toBeLessThanOrEqual(6000);
    expect(context.every(c => c.text.length + (c.translation?.length ?? 0) <= 1200)).toBe(true);
    expect(context.find(c => c.position === 'before')?.text.endsWith('TAIL')).toBe(true);
    expect(context.find(c => c.position === 'after')?.text.startsWith('HEAD')).toBe(true);
    expect(JSON.stringify(document)).toBe(original);
    expect(validateRequest({ ...input, context }).context).toEqual(context);
  });
  it('returns no context for unknown targets or a document entirely in the batch', () => {
    expect(buildTranslationContext(pages(), [{ id: 'unknown', text: 'x' }])).toEqual([]);
    expect(buildTranslationContext(pages(1), [{ id: 'p1_b1', text: 'Source 1' }])).toEqual([]);
  });
  it('does not split a surrogate pair when clipping either end of an excerpt', () => {
    const document = pages(3);
    document[0].blocks[0].source = '😀' + 'a'.repeat(1199);
    document[2].blocks[0].source = 'a'.repeat(1199) + '😀';
    const context = buildTranslationContext(document, [{ id: 'p2_b1', text: 'Source 2' }]);
    expect(context).toHaveLength(2);
    expect(context.every(c => c.text.isWellFormed())).toBe(true);
  });
  it('never uses a requested ID as context even in a sparse recovery batch', () => {
    const targets = [input.segments[0], { id: 'p7_b1', text: 'Source 7' }];
    expect(buildTranslationContext(pages(), targets).every(c => !targets.some(s => s.id === c.id))).toBe(true);
  });
  it('strips extra context fields and keeps explicit glossary text unchanged', () => {
    const context = [{ id: 'p4_b1', text: 'Previous capital.', position: 'before', translation: 'Capital previo.', key: 'secret' }];
    const validated = validateRequest({ ...input, context });
    expect(JSON.stringify(validated)).not.toContain('secret');
    expect(validated.glossary).toBe(input.glossary);
  });
  it.each([
    null, {}, [{ id: 'p5_b1', text: 'target', position: 'before' }],
    [{ id: 'p4_b1', text: ' ', position: 'before' }], [{ id: 'p4_b1', text: 'x', position: 'command' }],
    [{ id: 'p4_b1', text: 'x', position: 'before', translation: 42 }],
    [{ id: 'p4_b1', text: 'x'.repeat(1201), position: 'before' }],
    [{ id: 'p4_b1', text: 'x'.repeat(700), position: 'before', translation: 's'.repeat(600) }],
    Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, text: 'x', position: 'before' })),
    Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, text: 'x'.repeat(1100), position: 'before' })),
    [{ id: 'c', text: 'x', position: 'before' }, { id: 'c', text: 'y', position: 'after' }],
  ].map(context => ({ context })))('rejects malformed, excessive or overlapping context %#', ({ context }) => {
    expect(() => validateRequest({ ...input, context })).toThrow('invalid_context');
  });
  it('rejects context IDs in output without applying any of the batch', () => {
    expect(() => validateTranslationResult({ translations: [{ id: 'p4_b1', text: 'Referencia' }] }, input.segments))
      .toThrow('invalid_response');
  });
});
