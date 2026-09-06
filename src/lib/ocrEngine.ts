import type { PDFPageProxy } from 'pdfjs-dist';
import type { Worker, PSM } from 'tesseract.js';
import { extractOcrWords, RECOGNIZE_OUTPUT, type OcrWord } from './ocr';
import { TESSERACT_PATHS } from './ocrRuntime';
import {
  boundedScale,
  recognitionScore,
  unrotatePoint,
  transformPoint,
  wordsToText,
  type Matrix,
  type OcrOptions,
  type OcrPageResult,
  type QuarterTurn,
} from './ocrAdvanced';
import { renderPageToCanvas, loadPdfJs } from './pdfjs';

function canvas(width: number, height: number) {
  const result = document.createElement('canvas');
  result.width = Math.max(1, Math.ceil(width));
  result.height = Math.max(1, Math.ceil(height));
  return result;
}
function rotated(source: HTMLCanvasElement, turn: QuarterTurn, maxSide = Infinity) {
  const factor = Math.min(1, maxSide / Math.max(source.width, source.height));
  const swap = turn === 90 || turn === 270;
  const result = canvas(
    (swap ? source.height : source.width) * factor,
    (swap ? source.width : source.height) * factor
  );
  const ctx = result.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, result.width, result.height);
  ctx.translate(result.width / 2, result.height / 2);
  ctx.rotate((turn * Math.PI) / 180);
  ctx.scale(factor, factor);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return result;
}
/** Local adaptive threshold: retain the unmodified image as a competing candidate. */
function threshold(source: HTMLCanvasElement) {
  const result = rotated(source, 0);
  const ctx = result.getContext('2d')!;
  const data = ctx.getImageData(0, 0, result.width, result.height);
  const { width: w, height: h } = result;
  const gray = new Uint8Array(w * h);
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        p = i * 4;
      gray[i] = Math.round(
        data.data[p] * 0.299 + data.data[p + 1] * 0.587 + data.data[p + 2] * 0.114
      );
      sum += gray[i];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + sum;
    }
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const l = Math.max(0, x - 25),
        r = Math.min(w, x + 26),
        t = Math.max(0, y - 25),
        b = Math.min(h, y + 26);
      const average =
        (integral[b * (w + 1) + r] -
          integral[t * (w + 1) + r] -
          integral[b * (w + 1) + l] +
          integral[t * (w + 1) + l]) /
        ((r - l) * (b - t));
      const value = gray[y * w + x] < average - 9 ? 0 : 255;
      const p = (y * w + x) * 4;
      data.data[p] = data.data[p + 1] = data.data[p + 2] = value;
    }
  ctx.putImageData(data, 0, 0);
  return result;
}
const release = (image: HTMLCanvasElement | undefined) => {
  if (image) {
    image.width = 0;
    image.height = 0;
  }
};

/** One reusable local worker per run. Cancellation also interrupts a recognition in progress. */
export async function createOcrEngine(options: OcrOptions, signal: AbortSignal) {
  let worker: Worker | undefined;
  let closed = false;
  const check = () => {
    if (signal.aborted || closed) throw new DOMException('OCR cancelled', 'AbortError');
  };
  const close = async () => {
    closed = true;
    const current = worker;
    worker = undefined;
    await current?.terminate().catch(() => {});
  };
  const abort = () => {
    void close();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    check();
    const { createWorker } = await import('tesseract.js');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => {};
    try {
      const loading = createWorker(options.language, 1, TESSERACT_PATHS).then(async (created) => {
        if (closed || signal.aborted) {
          await created.terminate();
          check();
        }
        return created;
      });
      worker = await Promise.race([
        loading,
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new DOMException('OCR cancelled', 'AbortError'));
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
          timer = setTimeout(() => {
            void close();
            reject(new Error('OCR initialization timeout (60 s).'));
          }, 60_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
    if (closed || signal.aborted) {
      await worker.terminate();
      worker = undefined;
      check();
    }
  } catch (error) {
    signal.removeEventListener('abort', abort);
    throw error;
  }

  const recognize = async (image: HTMLCanvasElement, psm = '3') => {
    check();
    // terminate() does not settle tesseract's pending promise. Race an explicit abort/timeout.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => {};
    try {
      return await Promise.race([
        (async () => {
          await worker!.setParameters({ tessedit_pageseg_mode: psm as PSM });
          check();
          return worker!.recognize(image, {}, RECOGNIZE_OUTPUT);
        })(),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new DOMException('OCR cancelled', 'AbortError'));
          signal.addEventListener('abort', onAbort, { once: true });
          timer = setTimeout(() => {
            void close();
            reject(new Error('OCR timeout (90 s). Try Quick mode or a smaller document.'));
          }, 90_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  };

  return {
    async close() {
      signal.removeEventListener('abort', abort);
      await close();
    },
    async reread(page: PDFPageProxy, result: OcrPageResult, word: OcrWord) {
      const source = canvas(1, 1);
      let upright: HTMLCanvasElement | undefined, crop: HTMLCanvasElement | undefined;
      try {
        const base = page.getViewport({ scale: 1 });
        await renderPageToCanvas(
          page,
          source,
          boundedScale(base.width, base.height, options.mode),
          { signal }
        );
        upright = rotated(source, result.orientation);
        const l = Math.max(0, word.left - 3),
          t = Math.max(0, word.top - 3);
        const w = Math.min(upright.width - l, word.right - l + 3),
          h = Math.min(upright.height - t, word.bottom - t + 3);
        const factor = Math.min(2, 1800 / Math.max(w, h));
        crop = canvas(w * factor + 40, h * factor + 40);
        const ctx = crop.getContext('2d')!;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, crop.width, crop.height);
        ctx.drawImage(upright, l, t, w, h, 20, 20, w * factor, h * factor);
        return (await recognize(crop, '8')).data.text.trim();
      } finally {
        release(source);
        release(upright);
        release(crop);
        page.cleanup();
      }
    },
    async page(
      page: PDFPageProxy,
      progress: (message: string) => void = () => {}
    ): Promise<OcrPageResult> {
      check();
      const started = performance.now();
      const base = page.getViewport({ scale: 1 });
      const text = await page.getTextContent();
      const native = text.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .trim();
      let skip = options.skipText && native.length >= 100;
      if (options.skipText && native && !skip) {
        const { OPS } = await loadPdfJs();
        const operators = await page.getOperatorList();
        skip = !operators.fnArray.some(
          (op) =>
            op === OPS.paintImageXObject ||
            op === OPS.paintInlineImageXObject ||
            op === OPS.paintImageMaskXObject
        );
      }
      if (skip) {
        page.cleanup();
        return {
          page: page.pageNumber,
          words: [],
          text: native,
          width: base.width,
          height: base.height,
          toPdf: [1, 0, 0, -1, 0, base.height],
          orientation: 0,
          attempts: 0,
          milliseconds: Math.round(performance.now() - started),
          skipped: true,
          preview: '',
        };
      }
      let source: HTMLCanvasElement | undefined, upright: HTMLCanvasElement | undefined;
      let attempts = 0;
      try {
        source = canvas(1, 1);
        const scale = boundedScale(base.width, base.height, options.mode);
        const { viewport } = await renderPageToCanvas(page, source, scale, { signal });
        let turn: QuarterTurn = options.orientation === 'auto' ? 0 : options.orientation;
        if (options.orientation === 'auto') {
          let best = -1;
          for (const candidate of [0, 90, 180, 270] as const) {
            progress(`↻ ${candidate}°`);
            const probe = rotated(source, candidate, 1800);
            try {
              const result = await recognize(probe);
              attempts++;
              const score = recognitionScore(extractOcrWords(result.data));
              if (score > best) {
                best = score;
                turn = candidate;
              }
            } finally {
              release(probe);
            }
          }
        }
        check();
        progress(`${turn}° · ${Math.round(scale * 72)} dpi`);
        upright = rotated(source, turn);
        let best = (await recognize(upright)).data;
        attempts++;
        let words = extractOcrWords(best);
        // A whole alternative is compared, not concatenated: no duplicate or mismatched words.
        if (options.mode === 'deep' && recognitionScore(words) < 90) {
          progress('2/2');
          const enhanced = threshold(upright);
          try {
            const alternative = (await recognize(enhanced)).data;
            attempts++;
            const other = extractOcrWords(alternative);
            // Reject an apparently confident candidate that discarded substantial content.
            if (
              other.length >= words.length * 0.8 &&
              recognitionScore(other) > recognitionScore(words) + 2
            ) {
              best = alternative;
              words = other;
            }
          } finally {
            release(enhanced);
          }
        }
        check();
        const map = (x: number, y: number) => {
          const original = unrotatePoint(turn, source!.width, source!.height, x, y);
          return viewport.convertToPdfPoint(original.x, original.y);
        };
        const o = map(0, 0),
          x = map(1, 0),
          y = map(0, 1);
        const toPdf: Matrix = [x[0] - o[0], x[1] - o[1], y[0] - o[0], y[1] - o[1], o[0], o[1]];
        if (options.skipText && native) {
          // Preserve small native footers without duplicating them in the added layer.
          const boxes = text.items.flatMap((item) => {
            if (!('str' in item) || !item.str.trim()) return [];
            const [a, b, , , x, y] = item.transform;
            const norm = Math.hypot(a, b) || 1,
              ux = a / norm,
              uy = b / norm;
            const points = [
              [0, -item.height * 0.3],
              [item.width, -item.height * 0.3],
              [0, item.height],
              [item.width, item.height],
            ].map(([w, h]) => ({ x: x + ux * w - uy * h, y: y + uy * w + ux * h }));
            return [
              {
                l: Math.min(...points.map((p) => p.x)),
                r: Math.max(...points.map((p) => p.x)),
                t: Math.min(...points.map((p) => p.y)),
                b: Math.max(...points.map((p) => p.y)),
              },
            ];
          });
          words = words.filter((word) => {
            const points = [
              [word.left, word.top],
              [word.right, word.top],
              [word.left, word.bottom],
              [word.right, word.bottom],
            ].map(([x, y]) => transformPoint(toPdf, x, y));
            const l = Math.min(...points.map((p) => p.x)),
              r = Math.max(...points.map((p) => p.x)),
              t = Math.min(...points.map((p) => p.y)),
              b = Math.max(...points.map((p) => p.y));
            return !boxes.some(
              (box) =>
                Math.max(0, Math.min(r, box.r) - Math.max(l, box.l)) *
                  Math.max(0, Math.min(b, box.b) - Math.max(t, box.t)) >
                (r - l) * (b - t) * 0.25
            );
          });
        }
        const thumbnail = rotated(upright, 0, 1100);
        let preview: string;
        try {
          preview = thumbnail.toDataURL('image/jpeg', 0.85);
        } finally {
          release(thumbnail);
        }
        return {
          page: page.pageNumber,
          words,
          nativeText: options.skipText ? native : '',
          text: options.skipText && native ? `${wordsToText(words)}\n${native}` : best.text.trim(),
          width: upright.width,
          height: upright.height,
          toPdf,
          orientation: turn,
          attempts,
          milliseconds: Math.round(performance.now() - started),
          skipped: false,
          preview,
        };
      } finally {
        release(source);
        release(upright);
        page.cleanup();
      }
    },
  };
}
