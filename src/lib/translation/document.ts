import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { openPdf, renderPageToCanvas } from '@/lib/pdfjs';
import { createOcrEngine } from '@/lib/ocrEngine';
import { DEFAULT_OCR_OPTIONS, transformPoint } from '@/lib/ocrAdvanced';
import { detectPdfFonts } from '@/lib/studio/fonts';
import { savePdf } from '@/lib/pdfio';
import { fitBlock, groupRuns, isVerticalOcrRun, type TranslationPage, type TextRun, type TranslationBlock } from './layout';
import { TranslationError } from './contracts';
import { orderTranslationBlocks } from './order';
import { MAX_TRANSLATION_PAGES, READING_FONT, READING_FONT_SIZE, planReadingSheets, type ReadingSheet, type TranslationExportMode } from './reading';
import { selectedPageNumbers, contiguousSelectedPages, type TranslationScope } from './scope';

export async function analyzeTranslation(source: Uint8Array, options: {
  forceOcr: boolean; signal: AbortSignal; progress: (page: number, total: number) => void;
  checkpoint: (page: TranslationPage) => void;
  scope?: TranslationScope;
}) {
  if (source.length > 50 * 1024 * 1024) throw new TranslationError('file_too_large');
  const pdf = await openPdf(source);
  let ocr: Awaited<ReturnType<typeof createOcrEngine>> | undefined;
  try {
    const selected = selectedPageNumbers(pdf.document.numPages, options.scope ?? { mode: 'all' });
    for (const [index, n] of selected.entries()) {
      options.signal.throwIfAborted();
      options.progress(index + 1, selected.length);
      const page = await pdf.document.getPage(n);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const native = content.items.filter((item): item is TextItem => 'str' in item && !!item.str.trim());
        const warnings: string[] = [], runs: TextRun[] = [];
        // Use OCR for scans, broken Unicode maps, or explicitly requested mixed pages.
        const nativeText = native.map(i => i.str).join('');
        const useOcr = options.forceOcr || nativeText.length < 20 || /\uFFFD/.test(nativeText);
        if (useOcr) {
          ocr ??= await createOcrEngine({ ...DEFAULT_OCR_OPTIONS, language: 'eng', skipText: false }, options.signal);
          const result = await ocr.page(page);
          if (result.orientation !== 0) {
            // Refuse geometrically wrong overlays. User can rotate in Studio then retry.
            warnings.push('rotated_text');
          } else {
            for (const word of result.words) {
              const points = [[word.left, word.top], [word.right, word.bottom]].map(([x, y]) => {
                const p = transformPoint(result.toPdf, x, y);
                return viewport.convertToViewportPoint(p.x, p.y);
              });
              const x = Math.min(points[0][0], points[1][0]), y = Math.min(points[0][1], points[1][1]);
              const width = Math.abs(points[1][0] - points[0][0]), height = Math.abs(points[1][1] - points[0][1]);
              const run: TextRun = { text: word.text, x, y, width, height: height * 1.2, size: height,
                font: 'Helvetica', confidence: word.confidence, line: word.line };
              // Whole-page orientation does not identify sideways margin stamps.
              // Keep them in the original bitmap rather than merging them into headings.
              if (isVerticalOcrRun(run)) warnings.push('rotated_text');
              else runs.push(run);
            }
          }
        } else {
          // Loading operators resolves PDF.js font objects, improving family/style identification.
          await page.getOperatorList();
          const fonts = detectPdfFonts(page, native);
          const m = viewport.transform;
          for (const item of native) {
            const t = item.transform;
            const dx = m[0] * t[0] + m[2] * t[1], dy = m[1] * t[0] + m[3] * t[1];
            if (Math.abs(Math.atan2(dy, dx)) > 0.05) { warnings.push('rotated_text'); continue; }
            const [x, baseline] = viewport.convertToViewportPoint(t[4], t[5]);
            const size = Math.hypot(t[2], t[3]);
            const ascent = content.styles[item.fontName]?.ascent ?? 0.85;
            runs.push({ text: item.str, x, y: baseline - size * ascent, width: item.width,
              height: size * 1.15, size, font: fonts.get(item.fontName)?.name ?? 'Helvetica' });
          }
        }
        const valid = runs.filter(r => r.x >= -1 && r.y >= -1 && r.x + r.width <= viewport.width + 1 &&
          r.y + r.height <= viewport.height + 1);
        if (valid.length !== runs.length) warnings.push('outside_page');
        const blocks = groupRuns(valid, n);
        if (!blocks.length) warnings.push('no_text');
        options.signal.throwIfAborted();
        options.checkpoint({ number: n, width: viewport.width, height: viewport.height,
          method: useOcr ? 'ocr' : 'native', blocks: orderTranslationBlocks(blocks, viewport.width), warnings: [...new Set(warnings)] });
      } finally { page.cleanup(); }
    }
  } finally { await ocr?.close(); await pdf.destroy(); }
}

function standardFace(name: string): StandardFonts {
  const bold = /bold|black|heavy/i.test(name), italic = /italic|oblique/i.test(name);
  const family = /courier|mono/i.test(name) ? 'mono' : /times|serif|georgia|cambria/i.test(name) ? 'serif' : 'sans';
  if (family === 'mono') return bold ? (italic ? StandardFonts.CourierBoldOblique : StandardFonts.CourierBold)
    : italic ? StandardFonts.CourierOblique : StandardFonts.Courier;
  if (family === 'serif') return bold ? (italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold)
    : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
  return bold ? (italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold)
    : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
}

export interface LayoutIssue { id: string; page: number; reason: 'overflow' | 'unsupported_characters' | 'missing_translation' }
async function plansFor(pages: TranslationPage[], document: PDFDocument, mode: TranslationExportMode = 'preserve') {
  if (!['preserve', 'readable'].includes(mode)) throw new TranslationError('invalid_request');
  const fonts = new Map<string, PDFFont>();
  const faceFor = (name: string) => standardFace(mode === 'readable' ? READING_FONT : name);
  // Select one font per face BEFORE measuring: continuation metrics must match the exported font.
  for (const page of pages) for (const block of page.blocks.filter(b => b.included)) {
    const face = faceFor(block.font);
    if (!fonts.has(face)) fonts.set(face, await document.embedFont(face));
  }
  for (const face of fonts.keys()) {
    const texts = pages.flatMap(p => p.blocks.filter(b => b.included && faceFor(b.font) === face)
      .map(b => b.translated.replace(/\s/g, ' ')));
    if (texts.every(text => { try { fonts.get(face)!.encodeText(text); return true; } catch { return false; } })) continue;
    // Same-origin bundled PDF.js Liberation fonts; no document/font upload or third-party fetch.
    const bold = /Bold/.test(face), italic = /Italic|Oblique/.test(face);
    const style = bold ? (italic ? 'BoldItalic' : 'Bold') : italic ? 'Italic' : 'Regular';
    try {
      const response = await fetch(`/vendor/pdfjs/standard_fonts/LiberationSans-${style}.ttf`);
      if (!response.ok) throw new Error();
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 2_000_000) throw new Error();
      document.registerFontkit(fontkit);
      fonts.set(face, await document.embedFont(bytes, { subset: true }));
    } catch { /* Remain fail-closed with the standard font; the affected blocks report incompatibility. */ }
  }
  const plans = new Map<string, { font: PDFFont; fit: NonNullable<ReturnType<typeof fitBlock>> }>();
  const issues: LayoutIssue[] = [];
  const reading = new Map<number, ReadingSheet[]>();
  let totalPages = pages.length;
  for (const page of pages) {
    let needsReading = false;
    const startIssues = issues.length;
    for (const block of page.blocks.filter(b => b.included)) {
      if (!block.translated.trim()) { issues.push({ id: block.id, page: page.number, reason: 'missing_translation' }); continue; }
      const face = faceFor(block.font);
      let font = fonts.get(face);
      if (!font) { font = await document.embedFont(face); fonts.set(face, font); }
      try {
        // Validate the whole block even if its original box is too small to attempt wrapping.
        const text = block.translated.replace(/\s/g, ' '), glyphs = new Set(font.getCharacterSet());
        if (!text.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ||
            [...text].some(c => !glyphs.has(c.codePointAt(0)!))) throw new Error();
        font.encodeText(text);
        const preferred = mode === 'readable' ? READING_FONT_SIZE : block.size;
        const fit = fitBlock(block.translated, block, preferred, (text, size) => font.widthOfTextAtSize(text, size), mode === 'readable' ? READING_FONT_SIZE : 7);
        if (fit) plans.set(block.id, { font, fit });
        else if (mode === 'readable') needsReading = true;
        else issues.push({ id: block.id, page: page.number, reason: 'overflow' });
      } catch { issues.push({ id: block.id, page: page.number, reason: 'unsupported_characters' }); }
    }
    if (needsReading && issues.length === startIssues) {
      try {
        const sheets = planReadingSheets(page, (text, size, name) => fonts.get(standardFace(name))!.widthOfTextAtSize(text, size));
        totalPages += sheets.length;
        if (totalPages > MAX_TRANSLATION_PAGES) throw new TranslationError('output_too_large');
        reading.set(page.number, sheets);
      } catch (error) {
        if (error instanceof TranslationError) throw error;
        issues.push({ id: page.blocks.find(b => b.included)!.id, page: page.number, reason: 'unsupported_characters' });
      }
    }
  }
  return { plans, issues, reading, fonts };
}
export async function checkTranslationLayout(pages: TranslationPage[], mode: TranslationExportMode = 'preserve') {
  return (await plansFor(pages, await PDFDocument.create(), mode)).issues;
}

/** Sample the line border; use median to avoid a single dark glyph skewing the fill. */
function background(ctx: CanvasRenderingContext2D, b: TranslationBlock, sx: number, sy: number) {
  const colors: number[][] = [[], [], []];
  for (let i = 0; i <= 10; i++) {
    const x = Math.min(ctx.canvas.width - 1, Math.max(0, Math.round((b.x + b.width * i / 10) * sx)));
    const y = Math.min(ctx.canvas.height - 1, Math.max(0, Math.round(b.y * sy - 2)));
    const data = ctx.getImageData(x, y, 1, 1).data;
    colors.forEach((c, n) => c.push(data[n]));
  }
  return colors.map(c => c.sort((a, b) => a - b)[5]);
}

/** New PDF only. Original remains untouched. Raster backgrounds retain visual image placement. */
export async function exportTranslation(source: Uint8Array, pages: TranslationPage[], signal: AbortSignal,
  progress: (page: number) => void, options: { mode?: TranslationExportMode;
    complete?: (layout: { pageCount: number; sourcePages: number[] }) => void } = {}) {
  const output = await PDFDocument.create();
  const { plans, issues, reading, fonts } = await plansFor(pages, output, options.mode);
  if (issues.length) throw new TranslationError('layout_issues');
  const pdf = await openPdf(source);
  try {
    if (!contiguousSelectedPages(pages) || pages.at(-1)!.number > pdf.document.numPages) {
      throw new TranslationError('analysis_incomplete');
    }
    let totalImageBytes = 0;
    const sourcePages: number[] = [];
    for (const info of pages) {
      signal.throwIfAborted(); progress(info.number);
      const page = await pdf.document.getPage(info.number);
      const canvas = document.createElement('canvas');
      try {
        const scale = Math.min(2, 4000 / Math.max(info.width, info.height), Math.sqrt(8_000_000 / (info.width * info.height)));
        await renderPageToCanvas(page, canvas, scale, { signal });
        const ctx = canvas.getContext('2d')!;
        const sx = canvas.width / info.width, sy = canvas.height / info.height;
        for (const block of info.blocks.filter(b => b.included)) {
          const [r, g, b] = background(ctx, block, sx, sy);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          for (const line of block.lines) ctx.fillRect(line.x * sx - 1, line.y * sy - 1, line.width * sx + 2, line.height * sy + 2);
        }
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new TranslationError('export_failed');
        totalImageBytes += blob.size;
        if (totalImageBytes > 150 * 1024 * 1024) throw new TranslationError('output_too_large');
        const image = await output.embedPng(await blob.arrayBuffer());
        sourcePages.push(output.getPageCount() + 1);
        const sheets = reading.get(info.number);
        const target = output.addPage([info.width, info.height]);
        target.drawImage(image, { x: 0, y: 0, width: info.width, height: info.height });
        if (sheets) {
          for (let i = 0; i < sheets.length; i++) {
            signal.throwIfAborted();
            const sheet = sheets[i], continuation = output.addPage([sheet.width, sheet.height]);
            for (const line of sheet.lines) {
              const font = fonts.get(standardFace(line.font))!;
              if (line.text) continuation.drawText(line.text, { x: line.x,
                y: sheet.height - line.y - line.size * 0.9, size: line.size, font });
            }
          }
        } else for (const block of info.blocks.filter(b => b.included)) {
          const { font, fit } = plans.get(block.id)!;
          fit.lines.forEach((line, i) => target.drawText(line, { x: block.x,
            y: info.height - block.y - fit.size * 0.9 - i * fit.lineHeight, size: fit.size, font, color: rgb(0, 0, 0) }));
        }
      } finally { canvas.width = 0; canvas.height = 0; page.cleanup(); }
    }
    output.setTitle('Traducción al español argentino'); output.setLanguage('es-AR');
    output.setProducer('OpenPDF Translation (review required)');
    signal.throwIfAborted();
    const bytes = (await savePdf(output)).slice();
    signal.throwIfAborted();
    options.complete?.({ pageCount: output.getPageCount(), sourcePages });
    return bytes;
  } finally { await pdf.destroy(); }
}
