import { openPdf } from '@/lib/pdfjs';
import { createOcrEngine } from '@/lib/ocrEngine';
import { DEFAULT_OCR_OPTIONS } from '@/lib/ocrAdvanced';
import { TranslationError } from './contracts';
import type { Box, TranslationBlock, TranslationPage } from './layout';
import { validateRegionImage, validRegionalText } from './review-contract';

/** Viewport coordinates (rotation/CropBox already resolved during analysis), not raw PDF user space. */
export function regionGeometry(page: Pick<TranslationPage, 'width' | 'height'>, block: Box) {
  if (![page.width, page.height, block.x, block.y, block.width, block.height].every(Number.isFinite) ||
      page.width <= 0 || page.height <= 0 || block.width <= 0 || block.height <= 0 ||
      block.x < -1 || block.y < -1 || block.x + block.width > page.width + 1 ||
      block.y + block.height > page.height + 1) throw new TranslationError('invalid_region');
  const x = Math.max(0, block.x - 3), y = Math.max(0, block.y - 3);
  const width = Math.min(page.width, block.x + block.width + 3) - x;
  const height = Math.min(page.height, block.y + block.height + 3) - y;
  const scale = Math.min(4, 1998 / Math.max(width, height), Math.sqrt(2_990_000 / (width * height)));
  return { x, y, width, height, scale };
}

/** Render ONLY the selected region. Mask other detected blocks, including excluded blocks in padding. */
export async function prepareTranslationRegion(source: Uint8Array, info: TranslationPage,
  block: TranslationBlock, signal: AbortSignal) {
  signal.throwIfAborted();
  const area = regionGeometry(info, block);
  const pdf = await openPdf(source), canvas = document.createElement('canvas');
  try {
    const page = await pdf.document.getPage(info.number);
    try {
      const base = page.getViewport({ scale: 1 });
      if (Math.abs(base.width - info.width) > .1 || Math.abs(base.height - info.height) > .1) {
        throw new TranslationError('invalid_region');
      }
      canvas.width = Math.ceil(area.width * area.scale); canvas.height = Math.ceil(area.height * area.scale);
      const context = canvas.getContext('2d')!;
      const task = page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale: area.scale }),
        transform: [1, 0, 0, 1, -area.x * area.scale, -area.y * area.scale] });
      const abort = () => task.cancel();
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
      try { await task.promise; } finally { signal.removeEventListener('abort', abort); }
      signal.throwIfAborted();
      context.fillStyle = 'white';
      for (const other of info.blocks.filter(b => b.id !== block.id)) for (const line of other.lines) {
        if (line.x + line.width <= area.x || line.y + line.height <= area.y ||
            line.x >= area.x + area.width || line.y >= area.y + area.height) continue;
        context.fillRect((line.x - area.x) * area.scale - 1, (line.y - area.y) * area.scale - 1,
          line.width * area.scale + 2, line.height * area.scale + 2);
      }
      return { image: validateRegionImage(canvas.toDataURL('image/png')), bounds: area,
        width: canvas.width, height: canvas.height };
    } finally { page.cleanup(); }
  } finally { canvas.width = 0; canvas.height = 0; await pdf.destroy(); }
}
export async function rereadTranslationRegion(image: string, signal: AbortSignal) {
  validateRegionImage(image);
  const engine = await createOcrEngine({ ...DEFAULT_OCR_OPTIONS, language: 'eng', skipText: false }, signal);
  try { return (await engine.region(image)).filter(c => validRegionalText(c.text)); } finally { await engine.close(); }
}
