import { TranslationError } from './contracts';
import type { TranslationPage } from './layout';

export type TranslationExportMode = 'preserve' | 'readable';
export const MAX_TRANSLATION_PAGES = 500;
export const READING_FONT = 'Helvetica';
export const READING_FONT_SIZE = 12;
export interface ReadingLine {
  text: string; id: string; font: string; size: number; x: number; y: number;
}
export interface ReadingSheet { width: number; height: number; lines: ReadingLine[] }

/** Wrap without ellipses or inserted hyphens; long tokens split at Unicode code-point boundaries. */
export function wrapReadingText(text: string, width: number, measure: (text: string) => number): string[] {
  if (!Number.isFinite(width) || width <= 0) throw new TranslationError('layout_issues');
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= width) { line = next; continue; }
      if (line) { lines.push(line); line = ''; }
      if (measure(word) <= width) { line = word; continue; }
      for (const character of word) {
        if (measure(character) > width) throw new TranslationError('layout_issues');
        if (line && measure(line + character) > width) { lines.push(line); line = ''; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** A page with overflow moves ALL its included blocks, keeping detected reading order intact. */
export function planReadingSheets(page: TranslationPage,
  measure: (text: string, size: number, font: string) => number): ReadingSheet[] {
  if (![page.width, page.height].every(Number.isFinite) || page.width < 72 || page.height < 72) {
    throw new TranslationError('layout_issues');
  }
  const width = Math.max(300, page.width), height = Math.max(400, page.height);
  const margin = 36, top = 36, bottom = height - 36;
  const sheets: ReadingSheet[] = [];
  let cursor = top;
  const addSheet = () => {
    if (sheets.length >= MAX_TRANSLATION_PAGES) throw new TranslationError('output_too_large');
    sheets.push({ width, height, lines: [] }); cursor = top;
  };
  for (const block of page.blocks.filter(b => b.included)) {
    if (!block.translated.trim()) throw new TranslationError('layout_issues');
    const size = READING_FONT_SIZE, lineHeight = size * 1.3;
    const lines = wrapReadingText(block.translated, width - margin * 2, text => measure(text, size, READING_FONT));
    if (!sheets.length || cursor + lineHeight > bottom) addSheet();
    for (const text of lines) {
      if (cursor + lineHeight > bottom) addSheet();
      // IDs remain internal provenance, never visible document content.
      sheets[sheets.length - 1].lines.push({ text, id: block.id, font: READING_FONT, size, x: margin, y: cursor });
      cursor += lineHeight;
    }
    cursor += 12;
  }
  return sheets;
}
