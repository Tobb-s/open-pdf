import type { ViewportLike } from '@/lib/geometry';
import type { DetectedPdfFont } from '@/lib/studio/fonts';
import { createPaintLookup, type TextPaint } from '@/lib/studio/textAppearance';

/** Geometry needed to select and rebuild one pdf.js text item. */
export interface FlatTextRun {
  id: string;
  text: string;
  /** Text baseline in the flattened page's PDF space. */
  x: number;
  y: number;
  size: number;
  rotate: number;
  /** Source font identity, with bytes only when its original program is reusable. */
  sourceFont?: DetectedPdfFont | null;
  /** Original user-space baseline, independent of zoom/crop/page rotation. */
  source?: { x: number; y: number; fontId: string; size: number };
  appearance?: { color: string | null; opacity: number | null; mode: number; horizontalScale: number;
    charSpacing: number; wordSpacing: number; layer: string | null };
  metrics?: 'font' | 'estimated';
  /** Polygon avoids oversized rectangular hit areas on rotated/skewed text. */
  quad?: readonly (readonly number[])[];
  /** Axis-aligned bounds in the visual top-left frame, at scale 1. */
  visual: { left: number; top: number; width: number; height: number };
}

type TextItemLike = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
};

const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * Maps pdf.js text items into the coordinate system a rasterised page receives.
 *
 * The viewport owns crop and rotation, so this works for pages whose origin is
 * not (0, 0) and for every quarter turn. The visual bounds are deliberately a
 * little generous: selecting the whole glyph box is safer than leaving a thin
 * strip of the old text in the bitmap.
 */
export function flattenTextRuns(
  items: readonly unknown[],
  viewport: ViewportLike & { scale?: number },
  fonts: ReadonlyMap<string, DetectedPdfFont> = new Map(),
  styles: Readonly<Record<string, { ascent?: number; descent?: number; vertical?: boolean }>> = {},
  paints: readonly TextPaint[] = [],
): FlatTextRun[] {
  const scale = finite(viewport.scale, 1) || 1;
  const runs: FlatTextRun[] = [];
  const paintForItem = createPaintLookup(paints);

  items.forEach((raw, index) => {
    const item = raw as TextItemLike;
    const text = typeof item?.str === 'string' ? item.str : '';
    const transform = item?.transform;
    if (text.trim() === '' || !Array.isArray(transform) || transform.length < 6
      || !transform.every(Number.isFinite)) return;
    // Zero-advance combining marks without a base are often malformed encoding
    // artifacts. Do not place a large clickable rectangle over adjacent text.
    if (finite(item.width) <= 0 && /^\p{M}+$/u.test(text)) return;

    const a = finite(transform[0]);
    const b = finite(transform[1]);
    const originX = finite(transform[4]);
    const originY = finite(transform[5]);
    const angle = Math.atan2(b, a);
    const width = Math.max(finite(item.width), 1);
    const height = Math.max(Math.hypot(finite(transform[2]), finite(transform[3])), 0.01);
    const style = styles[item.fontName ?? ''];
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const nx = finite(transform[2]) / height;
    const ny = finite(transform[3]) / height;
    const measured = Number.isFinite(style?.ascent) && Number.isFinite(style?.descent);
    const descent = height * (measured ? -style.descent! : 0.22);
    const ascent = height * (measured ? style.ascent! : 0.9);

    const pdfCorners = [
      [originX - nx * descent, originY - ny * descent],
      [originX + ux * width - nx * descent, originY + uy * width - ny * descent],
      [originX + ux * width + nx * ascent, originY + uy * width + ny * ascent],
      [originX + nx * ascent, originY + ny * ascent],
    ] as const;
    const corners = pdfCorners.map(([x, y]) => viewport.convertToViewportPoint(x, y));
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const left = Math.min(...xs) / scale;
    const right = Math.max(...xs) / scale;
    const top = Math.min(...ys) / scale;
    const bottom = Math.max(...ys) / scale;

    const [startX, startY] = viewport.convertToViewportPoint(originX, originY);
    const [endX, endY] = viewport.convertToViewportPoint(originX + ux, originY + uy);
    const flatAngle = (Math.atan2(-(endY - startY), endX - startX) * 180) / Math.PI;
    const paint = paintForItem(item);

    runs.push({
      id: `text-${index}`,
      text,
      x: startX / scale,
      y: (viewport.height - startY) / scale,
      size: height,
      rotate: flatAngle,
      sourceFont: typeof item.fontName === 'string' ? fonts.get(item.fontName) ?? null : null,
      source: { x: originX, y: originY, fontId: item.fontName ?? '', size: height },
      appearance: paint ? { color: paint.color, opacity: paint.opacity, mode: paint.mode,
        horizontalScale: paint.horizontalScale, charSpacing: paint.charSpacing,
        wordSpacing: paint.wordSpacing, layer: paint.layer } : undefined,
      metrics: measured ? 'font' : 'estimated',
      quad: corners.map(([x, y]) => [x / scale, y / scale]),
      visual: {
        left,
        top,
        width: Math.max(right - left, 2),
        height: Math.max(bottom - top, 2),
      },
    });
  });

  return runs;
}
