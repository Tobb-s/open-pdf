import type { PDFPageProxy } from 'pdfjs-dist';
import { multiply, type Matrix } from '@/lib/pdf/textScan';
import { loadPdfJs } from '@/lib/pdfjs';

export interface TextPaint {
  fontId: string;
  text: string;
  x: number;
  y: number;
  color: string | null;
  opacity: number | null;
  mode: number;
  horizontalScale: number;
  charSpacing: number;
  wordSpacing: number;
  layer: string | null;
  glyphs: { text: string; x: number; y: number }[];
}
type FontMetrics = { fontMatrix?: number[]; vertical?: boolean; isType3Font?: boolean };
type Operators = { fnArray: number[]; argsArray: unknown[][] };
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const matrix = (arg: unknown): Matrix => Array.from(arg as ArrayLike<number>) as unknown as Matrix;

/** Interpret PDF.js's normalized paint operations, including nested Form transforms.
 * This enriches extraction; unsupported paint styles remain unknown, never guessed black.
 */
export function collectTextPaints(
  list: Operators, ops: Record<string, number>, fontOf: (id: string) => FontMetrics,
): TextPaint[] {
  let state = { ctm: IDENTITY, tm: IDENTITY, x: 0, y: 0, lineX: 0, lineY: 0,
    font: '', size: 0, scale: 1, char: 0, word: 0, leading: 0, rise: 0,
    color: '#000000' as string | null, stroke: '#000000' as string | null, opacity: 1, strokeOpacity: 1, masked: false, mode: 0 };
  const stack: typeof state[] = [];
  const layers: (string | null)[] = [];
  const paints: TextPaint[] = [];
  const names = new Map(Object.entries(ops).map(([key, value]) => [value, key]));
  const move = (x: number, y: number) => { state.x = state.lineX += x; state.y = state.lineY += y; };
  const show = (raw: unknown) => {
    let font: FontMetrics;
    try { font = fontOf(state.font); } catch { return; }
    // Vertical/Type3 advances require different glyph metrics. Keep extraction, but
    // don't attach a horizontal run's paint evidence to them.
    if (font.vertical || font.isType3Font || state.size <= 0 || !Array.isArray(raw)) return;
    let text = '';
    const positions: TextPaint['glyphs'] = [];
    const start = multiply([1, 0, 0, 1, state.x, state.y + state.rise], multiply(state.tm, state.ctm));
    for (const glyph of raw) {
      if (typeof glyph === 'number') { state.x -= glyph * state.size / 1000 * state.scale; continue; }
      if (!glyph || typeof glyph !== 'object') continue;
      const at = multiply([1, 0, 0, 1, state.x, state.y + state.rise], multiply(state.tm, state.ctm));
      positions.push({ text: typeof glyph.unicode === 'string' ? glyph.unicode : '', x: at[4], y: at[5] });
      text += typeof glyph.unicode === 'string' ? glyph.unicode : '';
      state.x += ((Number(glyph.width) || 0) * state.size * (font.fontMatrix?.[0] ?? 0.001)
        + state.char + (glyph.isSpace ? state.word : 0)) * state.scale;
    }
    if (text) paints.push({ fontId: state.font, text, x: start[4], y: start[5],
      color: state.mode === 1 ? state.stroke : state.mode === 0 || state.mode === 3 ? state.color : null,
      opacity: state.masked || (state.mode === 2 && state.opacity !== state.strokeOpacity) ? null
        : state.mode === 1 ? state.strokeOpacity : state.opacity,
      mode: state.mode, horizontalScale: state.scale,
      charSpacing: state.char, wordSpacing: state.word, layer: layers.at(-1) ?? null, glyphs: positions });
  };
  for (let i = 0; i < list.fnArray.length; i++) {
    const a = list.argsArray[i] ?? [];
    switch (names.get(list.fnArray[i])) {
      case 'save': stack.push({ ...state }); break;
      case 'restore': state = stack.pop() ?? state; break;
      case 'transform': state.ctm = multiply(matrix(a), state.ctm); break;
      case 'paintFormXObjectBegin':
        stack.push({ ...state });
        if (a[0]) state.ctm = multiply(matrix(a[0]), state.ctm);
        break;
      case 'paintFormXObjectEnd': state = stack.pop() ?? state; break;
      case 'beginText': state.tm = IDENTITY; state.x = state.y = state.lineX = state.lineY = 0; break;
      case 'setTextMatrix': state.tm = matrix(a.length === 1 ? a[0] : a); state.x = state.y = state.lineX = state.lineY = 0; break;
      case 'moveText': move(Number(a[0]), Number(a[1])); break;
      case 'setLeadingMoveText': state.leading = -Number(a[1]); move(Number(a[0]), Number(a[1])); break;
      case 'setLeading': state.leading = Number(a[0]); break;
      case 'nextLine': move(0, -state.leading); break;
      case 'setFont': state.font = String(a[0]); state.size = Number(a[1]); break;
      case 'setCharSpacing': state.char = Number(a[0]); break;
      case 'setWordSpacing': state.word = Number(a[0]); break;
      case 'setHScale': state.scale = Number(a[0]) / 100; break;
      case 'setTextRise': state.rise = Number(a[0]); break;
      case 'setTextRenderingMode': state.mode = Number(a[0]); break;
      case 'setFillRGBColor': state.color = typeof a[0] === 'string' ? a[0] : null; break;
      case 'setStrokeRGBColor': state.stroke = typeof a[0] === 'string' ? a[0] : null; break;
      case 'setFillColorN': case 'setFillColor': state.color = null; break;
      case 'setStrokeColorN': case 'setStrokeColor': state.stroke = null; break;
      case 'setGState':
        for (const [key, value] of (a[0] ?? []) as [string, unknown][]) {
          if (key === 'ca') state.opacity = Number(value);
          if (key === 'CA') state.strokeOpacity = Number(value);
          if (key === 'SMask') state.masked = value !== false && value !== null && value !== 'None';
          if (key === 'Font' && Array.isArray(value)) { state.font = String(value[0]); state.size = Number(value[1]); }
          if (key === 'TR' && value !== null) state.color = null;
        }
        break;
      case 'beginMarkedContent': layers.push(layers.at(-1) ?? null); break;
      case 'beginMarkedContentProps': {
        const props = a[1] as { id?: unknown } | null;
        layers.push(typeof a[1] === 'string' ? a[1] : typeof props?.id === 'string' ? props.id : layers.at(-1) ?? null);
        break;
      }
      case 'endMarkedContent': layers.pop(); break;
      case 'showText': case 'showSpacedText': show(a[0]); break;
      case 'nextLineShowText': move(0, -state.leading); show(a[0]); break;
      case 'nextLineSetSpacingShowText': state.word = Number(a[0]); state.char = Number(a[1]); move(0, -state.leading); show(a[2]); break;
    }
  }
  return paints;
}

export async function readTextPaints(page: PDFPageProxy): Promise<TextPaint[]> {
  const [{ OPS }, list] = await Promise.all([loadPdfJs(), page.getOperatorList()]);
  return collectTextPaints(list, OPS, id => page.commonObjs.get(id));
}

/** Match an item only to nearby paint with the same font and text, not by array index.
 * Extraction may split a single draw into many items (spaces, bidi, normalization).
 */
export function createPaintLookup(paints: readonly TextPaint[]) {
  const grid = new Map<string, { paint: TextPaint; index: number }[]>();
  for (const paint of paints) paint.glyphs.forEach((g, index) => {
    const key = `${paint.fontId}:${Math.floor(g.x)}:${Math.floor(g.y)}`;
    const bucket = grid.get(key) ?? [];
    bucket.push({ paint, index });
    grid.set(key, bucket);
  });
  return (item: { str?: string; fontName?: string; transform?: number[] }): TextPaint | null => {
  if (!item.transform || !item.str) return null;
  const normalize = (s: string) => s.normalize('NFKC').replace(/\s/g, '');
  const x = item.transform[4], y = item.transform[5];
  const candidates = new Set<TextPaint>();
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const { paint, index } of grid.get(`${item.fontName}:${Math.floor(x) + dx}:${Math.floor(y) + dy}`) ?? []) {
      const g = paint.glyphs[index];
      if (Math.hypot(g.x - x, g.y - y) < 0.75
        && normalize(paint.glyphs.slice(index).map(g => g.text).join('')).startsWith(normalize(item.str))) candidates.add(paint);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : null;
  };
}
