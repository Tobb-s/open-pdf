import { PDFDocument, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { openPdf } from '@/lib/pdfjs';
import { savePdf } from '@/lib/pdfio';
import { TranslationError } from './contracts';
import { validateRegionImage } from './review-contract';
import { cleanReadingConfirmed, validateCleanResult, type CleanPage, type CleanReference } from './clean-contract';
import { contiguousSelectedPages } from './scope';
import type { Box, TranslationPage } from './layout';
import { MAX_TRANSLATION_PAGES, READING_FONT_SIZE, wrapReadingText } from './reading';
import { cleanTextGroups } from './clean-groups';
import { plainCleanText, cleanParagraphText } from './clean-text';
import { figureSearchBox } from './clean-figure';

export function cleanReferences(page: TranslationPage): CleanReference[] {
  // Whole-page consent is explicit; include excluded OCR as reference too, never silently lose it.
  const compact = (text: string) => text.replace(/\s+/g, ' ').trim();
  const blocks = page.blocks.flatMap<Box & { id: string; source: string }>(b => {
    const original = b.lineTexts?.reduce((text, line) => text + (text.endsWith('-') ? '\n' : ' ') + line, '').trim();
    if (page.method !== 'ocr' || !b.lineTexts || b.lines.length !== b.lineTexts.length || b.lines.length < 2 ||
      compact(original ?? '') !== compact(b.source)) return [b];
    // A single grouped OCR block can span prose, a caption and a table header. Every original
    // line becomes independently accountable; edited text falls back to the complete user block.
    return b.lines.map((line, i) => ({ ...line, id: `${b.id}_l${i + 1}`, source: b.lineTexts![i] }));
  });
  return blocks.map(b => ({ id: b.id, text: b.source,
    x: Math.max(0, b.x / page.width * 1000), y: Math.max(0, b.y / page.height * 1000),
    width: Math.min(b.width, page.width - Math.max(0, b.x)) / page.width * 1000,
    height: Math.min(b.height, page.height - Math.max(0, b.y)) / page.height * 1000 }));
}

/** Render untouched source ink. Unlike regional OCR review, never mask other blocks in a figure. */
export async function cleanSourceImage(source: Uint8Array, info: Pick<CleanPage, 'number' | 'width' | 'height'>,
  signal: AbortSignal, box: Box = { x: 0, y: 0, width: 1000, height: 1000 }, mask: Box[] = []) {
  signal.throwIfAborted();
  const pdf = await openPdf(source), canvas = document.createElement('canvas');
  try {
    const page = await pdf.document.getPage(info.number);
    try {
      const base = page.getViewport({ scale: 1 });
      if (Math.abs(base.width - info.width) > .1 || Math.abs(base.height - info.height) > .1) throw new TranslationError('invalid_region');
      const x = box.x / 1000 * info.width, y = box.y / 1000 * info.height;
      const width = box.width / 1000 * info.width, height = box.height / 1000 * info.height;
      if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 ||
          x + width > info.width + .1 || y + height > info.height + .1) throw new TranslationError('invalid_region');
      let scale = Math.min(3, 1600 / Math.max(width, height), Math.sqrt(2500000 / (width * height)));
      for (let attempt = 0; attempt < 4; attempt++, scale *= .8) {
        signal.throwIfAborted();
        canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
        const task = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: page.getViewport({ scale }),
          transform: [1, 0, 0, 1, -x * scale, -y * scale] });
        const abort = () => task.cancel();
        signal.addEventListener('abort', abort, { once: true });
        try { await task.promise; } finally { signal.removeEventListener('abort', abort); }
        signal.throwIfAborted();
        const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white';
        for (const other of mask) {
          if (![other.x, other.y, other.width, other.height].every(Number.isFinite)) throw new TranslationError('invalid_region');
          ctx.fillRect((other.x / 1000 * info.width - x) * scale, (other.y / 1000 * info.height - y) * scale,
            other.width / 1000 * info.width * scale, other.height / 1000 * info.height * scale);
        }
        try { return validateRegionImage(canvas.toDataURL('image/png')); }
        catch { if (attempt === 3) throw new TranslationError('invalid_region'); }
      }
      throw new TranslationError('invalid_region');
    } finally { page.cleanup(); }
  } finally { canvas.width = 0; canvas.height = 0; await pdf.destroy(); }
}

export interface CleanPlacement { page: number; element: number; sheet: number; x: number; y: number;
  text?: string; width?: number; height?: number; sourceBox?: Box }
export const CLEAN_WIDTH = 595.28, CLEAN_HEIGHT = 841.89, CLEAN_MARGIN = 48;
/** Position images as indivisible elements in the SAME stream as paragraphs. Never sort after layout. */
export function planCleanDocument(pages: CleanPage[], measure: (text: string) => number) {
  if (!contiguousSelectedPages(pages)) {
    throw new TranslationError('analysis_incomplete');
  }
  const placements: CleanPlacement[] = [], sourcePages: number[] = [];
  const groups = cleanTextGroups(pages), followers = new Set(groups.flatMap(g => g.parts.slice(1).map(p => `${p.page}:${p.element}`)));
  const leaders = new Map(groups.map(g => [`${g.parts[0].page}:${g.parts[0].element}`, g]));
  let sheet = 0, cursor = CLEAN_MARGIN;
  const bottom = CLEAN_HEIGHT - CLEAN_MARGIN, lineHeight = READING_FONT_SIZE * 1.4;
  const next = () => { if (++sheet >= MAX_TRANSLATION_PAGES) throw new TranslationError('output_too_large'); cursor = CLEAN_MARGIN; };
  for (const page of pages) {
    const checked = validateCleanResult({ elements: page.elements }, page.reference);
    for (let i = 0; i < page.elements.length; i++) {
      const e = page.elements[i], compact = (text: string) => text.replace(/\s+/g, ' ').trim();
      if (e.kind === 'heading' && !e.ids.length && e.text.length >= 15 &&
        ((page.elements[i - 1]?.kind === 'paragraph' && compact(page.elements[i - 1].text).endsWith(compact(e.text))) ||
         (page.elements[i + 1]?.kind === 'paragraph' && compact(page.elements[i + 1].text).startsWith(compact(e.text))))) {
        throw new TranslationError('clean_uncertain');
      }
    }
    let first: number | undefined;
    for (let i = 0; i < page.elements.length; i++) {
      const e = page.elements[i];
      if (checked[i].uncertain && !cleanReadingConfirmed(e.text, e.verification)) throw new TranslationError('clean_uncertain');
      if (e.kind === 'noise') continue;
      if (followers.has(`${page.number}:${i}`)) continue;
      if (e.kind === 'figure') {
        const ratio = e.box.width * page.width / (e.box.height * page.height);
        if (!Number.isFinite(ratio) || ratio <= 0) throw new TranslationError('invalid_region');
        // Keep small logos/illustrations small; scale down oversized figures, never inflate them.
        const width = Math.min(CLEAN_WIDTH - CLEAN_MARGIN * 2, e.box.width / 1000 * page.width, (bottom - CLEAN_MARGIN) * ratio);
        const height = width / ratio;
        if (cursor + height > bottom) next();
        first ??= sheet + 1;
        placements.push({ page: page.number, element: i, sheet, x: (CLEAN_WIDTH - width) / 2, y: cursor, width, height, sourceBox: { ...e.box } });
        cursor += height + 12;
        continue;
      }
      if (!e.translated?.trim()) throw new TranslationError('layout_issues');
      if (/\[(?:illegible|ilegible)\]/i.test(e.translated)) throw new TranslationError('clean_uncertain');
      const group = leaders.get(`${page.number}:${i}`);
      if (group && group.parts.length > 1 && e.translatedSource !== group.text) throw new TranslationError('layout_issues');
      if (e.kind === 'heading') cursor += 12;
      const plain = plainCleanText(e.translated, group?.text ?? e.text);
      const lines = wrapReadingText(e.kind === 'formula' ? plain : cleanParagraphText(plain), CLEAN_WIDTH - CLEAN_MARGIN * 2, measure);
      const following = page.elements[i + 1];
      if (following?.kind === 'figure' && /^(?:Figure|Table|Figura|Tabla)\s*\d/i.test(e.text.trim()) && lines.length <= 5) {
        const ratio = following.box.width * page.width / (following.box.height * page.height);
        const height = Math.min(CLEAN_WIDTH - CLEAN_MARGIN * 2, following.box.width / 1000 * page.width, (bottom - CLEAN_MARGIN) * ratio) / ratio;
        const needed = lines.length * lineHeight + 10 + height;
        if (needed <= bottom - CLEAN_MARGIN && cursor + needed > bottom) next();
      }
      // Avoid an orphan heading where possible; same font and size, hierarchy through whitespace.
      if (e.kind === 'heading' && cursor + (lines.length + 2) * lineHeight > bottom) next();
      for (const text of lines) {
        if (cursor + lineHeight > bottom) next();
        first ??= sheet + 1;
        placements.push({ page: page.number, element: i, sheet, x: CLEAN_MARGIN, y: cursor, text });
        cursor += lineHeight;
      }
      cursor += e.kind === 'heading' ? 8 : 10;
    }
    sourcePages.push(first ?? (sheet + 1));
  }
  return { placements, sourcePages, pageCount: placements.length ? Math.max(...placements.map(p => p.sheet)) + 1 : 1 };
}

/** Expand the approximate AI crop, then locate actual ink. Reject collisions with known prose,
 * rather than silently exporting a clipped figure or duplicating nearby paragraphs. */
export async function refineCleanFigure(source: Uint8Array, page: CleanPage, index: number, signal: AbortSignal): Promise<Box> {
  const e = page.elements[index], area = figureSearchBox(page, index), { x, y } = area;
  const png = await cleanSourceImage(source, page, signal, area);
  const image = new Image(); image.src = png; await image.decode(); signal.throwIfAborted();
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  try {
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const rows = new Uint32Array(canvas.height), cols = new Uint32Array(canvas.width);
    for (let yy = 0; yy < canvas.height; yy++) for (let xx = 0; xx < canvas.width; xx++) {
      const i = (yy * canvas.width + xx) * 4;
      if (data[i + 3] > 200 && Math.min(data[i], data[i + 1], data[i + 2]) < 235) { rows[yy]++; cols[xx]++; }
    }
    const ys = Array.from(rows).flatMap((n, i) => n >= 3 ? [i] : []), xs = Array.from(cols).flatMap((n, i) => n >= 3 ? [i] : []);
    if (!xs.length || !ys.length) throw new TranslationError('clean_uncertain');
    const left = Math.max(0, xs[0] - 3), top = Math.max(0, ys[0] - 3);
    const right = Math.min(canvas.width, xs.at(-1)! + 4), bottom = Math.min(canvas.height, ys.at(-1)! + 4);
    if (left === 0 || top === 0 || right === canvas.width || bottom === canvas.height) throw new TranslationError('clean_uncertain');
    const box = { x: x + left / canvas.width * area.width, y: y + top / canvas.height * area.height,
      width: (right - left) / canvas.width * area.width, height: (bottom - top) / canvas.height * area.height };
    if (page.reference.filter(b => !e.ids.includes(b.id)).some(b => Math.min(box.x + box.width, b.x + b.width) > Math.max(box.x, b.x) &&
      Math.min(box.y + box.height, b.y + b.height) > Math.max(box.y, b.y))) throw new TranslationError('clean_uncertain');
    return box;
  } finally { canvas.width = 0; canvas.height = 0; }
}

async function uniformFont(output: PDFDocument, texts: string[]): Promise<PDFFont> {
  const response = await fetch('/fonts/DejaVuSans.ttf');
  if (!response.ok) throw new TranslationError('layout_issues');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 2000000) throw new TranslationError('layout_issues');
  output.registerFontkit(fontkit);
  const font = await output.embedFont(bytes, { subset: true });
  const supported = () => {
    const glyphs = new Set(font.getCharacterSet());
    return texts.every(text => text.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) &&
      [...text.replace(/\s/g, ' ')].every(c => glyphs.has(c.codePointAt(0)!)));
  };
  if (!supported()) throw new TranslationError('layout_issues');
  return font;
}

export async function exportCleanTranslation(source: Uint8Array, pages: CleanPage[], signal: AbortSignal,
  progress: (page: number) => void = () => {}) {
  signal.throwIfAborted();
  const pdf = await openPdf(source);
  try {
    if (!contiguousSelectedPages(pages) || pages.at(-1)!.number > pdf.document.numPages) throw new TranslationError('analysis_incomplete');
  } finally { await pdf.destroy(); }
  pages = structuredClone(pages);
  for (const p of pages) for (let i = 0; i < p.elements.length; i++) {
    if (p.elements[i].kind === 'figure') p.elements[i].box = await refineCleanFigure(source, p, i, signal);
  }
  const output = await PDFDocument.create();
  const font = await uniformFont(output, pages.flatMap(p => p.elements.filter(e => e.kind !== 'noise' && e.kind !== 'figure').map(e => e.translated)));
  const layout = planCleanDocument(pages, text => font.widthOfTextAtSize(text, READING_FONT_SIZE));
  const pagesByNumber = new Map(pages.map(page => [page.number, page]));
  for (let i = 0; i < layout.pageCount; i++) output.addPage([CLEAN_WIDTH, CLEAN_HEIGHT]);
  let imageBytes = 0;
  const images = new Map<string, Awaited<ReturnType<typeof output.embedPng>>>();
  for (const position of layout.placements) {
    signal.throwIfAborted();
    const target = output.getPage(position.sheet);
    if (position.text !== undefined) {
      if (position.text) target.drawText(position.text, { x: position.x, y: CLEAN_HEIGHT - position.y - READING_FONT_SIZE,
        size: READING_FONT_SIZE, font });
    } else {
      const info = pagesByNumber.get(position.page)!, e = info.elements[position.element], key = `${position.page}:${position.element}`;
      if (!images.has(key)) {
        progress(info.number);
        const png = await cleanSourceImage(source, info, signal, e.box);
        imageBytes += png.length * .75;
        if (imageBytes > 150 * 1024 * 1024) throw new TranslationError('output_too_large');
        images.set(key, await output.embedPng(png));
      }
      target.drawImage(images.get(key)!, { x: position.x, y: CLEAN_HEIGHT - position.y - position.height!,
        width: position.width!, height: position.height! });
    }
  }
  output.setTitle('Traducción al español argentino - lectura limpia'); output.setLanguage('es-AR');
  output.setProducer('OpenPDF');
  signal.throwIfAborted();
  const bytes = (await savePdf(output)).slice();
  signal.throwIfAborted();
  return { bytes, layout };
}
