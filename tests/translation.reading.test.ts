import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { vi } from 'vitest';
import { wrapReadingText, planReadingSheets } from '@/lib/translation/reading';
import { checkTranslationLayout } from '@/lib/translation/document';
import type { TranslationPage } from '@/lib/translation/layout';

const page = (): TranslationPage => ({ number: 1, width: 400, height: 400, method: 'native', warnings: [], blocks: [{
  id: 'p1_b1', source: 'English source', translated: 'Primero segundo tercero. '.repeat(150) + 'MARCAFINAL', included: true,
  x: 20, y: 30, width: 100, height: 14, size: 12, font: 'Helvetica', lines: [{ x: 20, y: 30, width: 100, height: 14 }],
}] });
describe('readable translation layout', () => {
  const measure = (text: string, size: number) => text.length * size * .5;
  it('moves overflow to multiple readable pages without dropping or repeating words', () => {
    const source = page(); const original = JSON.stringify(source);
    const sheets = planReadingSheets(source, measure);
    expect(sheets.length).toBeGreaterThan(1);
    const lines = sheets.flatMap(s => s.lines.filter(l => l.size >= 11));
    expect(lines.map(l => l.text).join(' ').replace(/\s+/g, ' ').trim()).toBe(source.blocks[0].translated);
    expect(lines.every(l => l.size >= 11 && l.x >= 36 && l.y + l.size * 1.3 <= 364)).toBe(true);
    expect(JSON.stringify(source)).toBe(original);
  });
  it('splits long tokens without inserted hyphens or broken Unicode', () => {
    const source = '😀'.repeat(25) + 'URLMUYLARGA'.repeat(20);
    const lines = wrapReadingText(source, 20, text => [...text].length);
    expect(lines.join('')).toBe(source); expect(lines.every(l => l.isWellFormed())).toBe(true);
  });
  it('preserves paragraph boundaries and explicit blank lines', () => {
    expect(wrapReadingText('Primero\r\n\r\nSegundo', 100, text => text.length)).toEqual(['Primero', '', 'Segundo']);
  });
  it('preserves block order and excludes unchecked blocks', () => {
    const source = page(); source.blocks[0].translated = 'UNO';
    source.blocks.push({ ...source.blocks[0], id: 'p1_b2', included: false, translated: 'PRIVADO' },
      { ...source.blocks[0], id: 'p1_b3', translated: 'TRES' });
    expect(planReadingSheets(source, measure).flatMap(s => s.lines.filter(l => l.size >= 11).map(l => l.text)))
      .toEqual(['UNO', 'TRES']);
  });
  it('uses one fixed font and size regardless of source typography, with no printed IDs', () => {
    const source = page(); source.blocks[0].size = 3;
    source.blocks[0].font = 'Times-BoldItalic';
    const first = planReadingSheets(source, measure);
    source.blocks[0].size = 100;
    source.blocks[0].font = 'Courier';
    expect(planReadingSheets(source, measure)).toEqual(first);
    expect(first.flatMap(s => s.lines).every(l => l.size === 12 && l.font === 'Helvetica')).toBe(true);
    expect(first.flatMap(s => s.lines).some(l => /p1_b1|continúa/.test(l.text))).toBe(false);
  });
  it('does not strip genuine text that happens to resemble an internal ID', () => {
    const source = page(); source.blocks[0].translated = 'La variable p1_b1 vale 1985.';
    expect(planReadingSheets(source, measure)[0].lines.map(l => l.text)).toEqual(['La variable p1_b1 vale 1985.']);
  });
  it('bounds pathological page growth instead of silently truncating', () => {
    const source = page(); source.blocks[0].translated = 'a '.repeat(50_000);
    expect(() => planReadingSheets(source, () => 400)).toThrow('layout_issues');
    expect(() => planReadingSheets(source, text => [...text].length * 228)).toThrow('output_too_large');
  });
  it.each([0, -1, NaN, Infinity])('rejects invalid wrap widths %s', width => {
    expect(() => wrapReadingText('Texto', width, text => text.length)).toThrow();
  });
  it('rejects missing translation rather than producing an empty continuation', () => {
    const source = page(); source.blocks[0].translated = '';
    expect(() => planReadingSheets(source, measure)).toThrow('layout_issues');
  });
  it('allows readable overflow while original-layout mode remains strict', async () => {
    expect(await checkTranslationLayout([page()])).toEqual([{ id: 'p1_b1', page: 1, reason: 'overflow' }]);
    expect(await checkTranslationLayout([page()], 'readable')).toEqual([]);
  });
  it('reflows instead of shrinking or using smaller source glyphs', async () => {
    const source = page(); Object.assign(source.blocks[0], { size: 7, height: 9, translated: 'Texto breve.' });
    expect(await checkTranslationLayout([source], 'readable')).toEqual([]);
    expect(planReadingSheets(source, measure)[0].lines[0].size).toBe(12);
  });
  it('still reports unsupported glyphs and missing translations in readable mode', async () => {
    const source = page(); source.blocks[0].translated = 'Texto 漢';
    expect(await checkTranslationLayout([source], 'readable')).toEqual([{ id: 'p1_b1', page: 1, reason: 'unsupported_characters' }]);
    source.blocks[0].translated = '';
    expect(await checkTranslationLayout([source], 'readable')).toEqual([{ id: 'p1_b1', page: 1, reason: 'missing_translation' }]);
  });
  it('wraps against actual PDF font metrics within continuation margins', async () => {
    const document = await PDFDocument.create(), font = await document.embedFont(StandardFonts.Helvetica);
    const sheets = planReadingSheets(page(), (text, size) => font.widthOfTextAtSize(text, size));
    expect(sheets.flatMap(s => s.lines.filter(l => l.size >= 11)).every(l => font.widthOfTextAtSize(l.text, l.size) <= 328)).toBe(true);
  });
  it('attributes an unsupported glyph to its own tiny-box block before reflow', async () => {
    const source = page();
    source.blocks.push({ ...source.blocks[0], id: 'p1_b2', height: 1, translated: '漢' });
    expect(await checkTranslationLayout([source], 'readable')).toEqual([
      { id: 'p1_b2', page: 1, reason: 'unsupported_characters' },
    ]);
  });
  it('uses bundled font coverage for Greek/math without silently accepting missing Chinese glyphs', async () => {
    const bytes = await readFile('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(bytes)));
    try {
      const source = page(); source.blocks[0].translated = 'Y = φ K; ∫ x';
      source.blocks[0].font = 'Times-BoldItalic';
      source.blocks.push({ ...source.blocks[0], id: 'p1_b2', font: 'Courier', translated: 'Otra fórmula: φ = 2.' });
      expect(await checkTranslationLayout([source], 'readable')).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith('/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf');
      source.blocks[0].translated = '漢';
      expect(await checkTranslationLayout([source], 'readable')).toEqual([
        { id: 'p1_b1', page: 1, reason: 'unsupported_characters' },
      ]);
    } finally { vi.unstubAllGlobals(); }
  });
});
