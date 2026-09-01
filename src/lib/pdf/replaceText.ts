import type { Operation } from '@/lib/pdf/contentStream';
import { spliceBytes } from '@/lib/pdf/contentStream';
import type { FontMap } from '@/lib/pdf/fontMap';
import { UNREADABLE, type ScannedText, type ShowRun } from '@/lib/pdf/textScan';

/**
 * Replacing a word by editing the operators that draw it.
 *
 * The one thing this refuses to do is produce a document that looks right and
 * is not. Every way a replacement can fail has a name here and is returned
 * rather than worked around, because the failures are not exotic: a subsetted
 * font that has no «ñ» because the document never used one is the ordinary
 * case, not the corner.
 *
 * What «almost exact» means, precisely. The new glyphs are drawn by the same
 * font resource as the old ones, at the same size, from the same pen position —
 * so the shapes are the document's own, not a lookalike. What cannot be
 * identical is the width: a different word is a different length, and something
 * has to give. The caller chooses what: let the rest of the line shift by the
 * difference, or keep the line and squeeze the word into the space the old one
 * had. Neither is hidden.
 */

export interface Occurrence {
  /** Where it sits in the scanned page text. */
  start: number;
  end: number;
  text: string;
  /** The run that draws it, and the glyph range within it. */
  run: number;
  firstGlyph: number;
  lastGlyph: number;
  font: FontMap | null;
  size: number;
  /** Where it is on the page, for showing the reader what will change. */
  box: { x: number; y: number; width: number; height: number };
}

export interface FindOptions {
  /** Default false: «Juan» and «juan» are different words to a reader. */
  ignoreCase?: boolean;
  /** Default false. When true, a match must not have a letter or digit beside it. */
  wholeWord?: boolean;
  /** Default false. Text drawn with render mode 3 is a scan's invisible layer. */
  includeInvisible?: boolean;
}

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[\p{L}\p{N}]/u.test(character);

/**
 * Finds every place a phrase is drawn, and where its glyphs live.
 *
 * A match that crosses two show operators is reported as found and will be
 * refused at planning time. Reporting it is the point: a reader who searched
 * for a name deserves to know it is on the page even when this cannot rewrite
 * it, rather than be told it is not there.
 */
export function findOccurrences(
  scan: ScannedText,
  needle: string,
  options: FindOptions = {}
): Occurrence[] {
  if (needle.length === 0) return [];
  // A search that could match an unreadable glyph would let a replacement
  // delete a character nobody saw.
  if (needle.includes(UNREADABLE)) return [];

  const haystack = options.ignoreCase ? scan.text.toLowerCase() : scan.text;
  const target = options.ignoreCase ? needle.toLowerCase() : needle;
  const found: Occurrence[] = [];

  for (let at = haystack.indexOf(target); at >= 0; at = haystack.indexOf(target, at + 1)) {
    const end = at + target.length;
    if (options.wholeWord) {
      if (isWordCharacter(scan.text[at - 1]) || isWordCharacter(scan.text[end])) continue;
    }

    // Every character of the match has to come from a real glyph. A match that
    // relies on an inferred space is a match across a gap in the file, and
    // there is nothing there to rewrite.
    const places = scan.positions.slice(at, end);
    if (places.some((place) => place === null)) continue;
    const positions = places as Array<{ run: number; glyph: number }>;

    const run = positions[0].run;
    const glyphs = positions.map((place) => place.glyph);
    const firstGlyph = Math.min(...glyphs);
    const lastGlyph = Math.max(...glyphs);

    found.push({
      start: at,
      end,
      text: scan.text.slice(at, end),
      run,
      firstGlyph,
      lastGlyph,
      font: scan.runs[run].font,
      size: scan.runs[run].size,
      box: boxOf(scan.runs[run], firstGlyph, lastGlyph),
    });
  }

  return found.filter(
    (occurrence) => options.includeInvisible || scan.runs[occurrence.run].renderMode !== 3
  );
}

/** A rectangle around a glyph range, in page space. */
function boxOf(run: ShowRun, firstGlyph: number, lastGlyph: number) {
  const first = run.glyphs[firstGlyph];
  const last = run.glyphs[lastGlyph];
  if (!first || !last) return { x: 0, y: 0, width: 0, height: 0 };
  // The vertical extent is taken from the font size rather than measured: glyph
  // bounding boxes need the font program, and a box that is slightly generous
  // is the right error for something a reader is about to point at.
  const height = run.size * 1.2;
  return {
    x: Math.min(first.x, last.x),
    y: Math.min(first.y, last.y) - run.size * 0.25,
    width: Math.abs(last.x + last.advance - first.x),
    height,
  };
}

export type RefusalReason =
  /** The font has no code for one or more characters of the replacement. */
  | 'missing-glyphs'
  /** The word is drawn by more than one show operator, or its font is unknown. */
  | 'split'
  /** The operator that draws it is one this does not rewrite. */
  | 'unsupported-operator'
  /** Some glyph of the match could not be read, so its bytes cannot be trusted. */
  | 'unreadable'
  /** The replacement is so much longer or shorter that squeezing it would smear it. */
  | 'too-different';

export interface Refusal {
  ok: false;
  reason: RefusalReason;
  /** For `missing-glyphs`, exactly which characters the font cannot draw. */
  missing: string[];
  /** For `too-different`, how far the squeeze would have had to go. */
  ratio?: number;
}

export interface PlannedEdit {
  ok: true;
  occurrence: Occurrence;
  /** The byte range of the whole show operation, and what replaces it. */
  edit: { start: number; end: number; replacement: Uint8Array };
  /**
   * How far the rest of the line will move, in page units.
   *
   * Zero for `squeeze` and `keep-layout`, which both hold the line still.
   * Non-zero only for `keep-flow`, where it is the real consequence: everything
   * after the word on that line shifts by this much.
   */
  widthDelta: number;
  /**
   * How much wider the new word is than the old before anything is done about
   * it. This is the number that says whether a squeeze will be invisible, and
   * whether `keep-layout` will collide with the next word or leave a gap.
   */
  naturalWidthDelta: number;
  /** The horizontal scaling written into the stream, as a percentage. */
  horizontalScale: number;
  /** Which of the three trade-offs this plan took. */
  fit: Fit;
}

export type Plan = PlannedEdit | Refusal;

/**
 * What to do about the one thing that cannot be preserved.
 *
 * A different word is a different length. There are exactly three things that
 * can be done with the difference and each costs something; there is no fourth,
 * and no default that avoids the choice.
 */
export type Fit =
  /**
   * Scale the new word horizontally to the old word's width.
   *
   * Nothing else on the page moves, there is no gap and no overlap, and the
   * glyphs are the document's own — stretched or compressed. For the ordinary
   * case of a name of similar length the distortion is a few percent and no
   * reader would see it. For «Sr.» becoming «Excelentísimo» it is a smear, and
   * `maxScale` refuses it rather than produce one.
   */
  | 'squeeze'
  /**
   * Draw the new word at its natural width and put the pen back afterwards.
   *
   * The glyphs are undistorted and nothing after the word moves — but a longer
   * word runs into whatever follows it, and a shorter one leaves a gap.
   */
  | 'keep-layout'
  /**
   * Draw the new word at its natural width and let the rest of the line follow.
   *
   * No distortion and no collision. The remainder of the line moves by the
   * width difference, which is visible, and which is sometimes exactly right —
   * it is what a word processor would do.
   */
  | 'keep-flow';

export interface PlanOptions {
  fit?: Fit;
  /**
   * How far a squeeze may go, as a ratio. Default allows half to double.
   */
  maxScale?: number;
}

const formatNumber = (value: number): string => {
  if (Object.is(value, -0) || Math.abs(value) < 1e-6) return '0';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
};

const hexOf = (codes: readonly number[], codeBytes: number): string => {
  let out = '';
  for (const code of codes) {
    for (let byte = codeBytes - 1; byte >= 0; byte -= 1) {
      out += ((code >> (byte * 8)) & 0xff).toString(16).padStart(2, '0').toUpperCase();
    }
  }
  return out;
};

const asciiBytes = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff);

/**
 * The advance one code contributes, under a run's own state.
 *
 * Deliberately the same expression the scan uses for the glyphs being replaced.
 * If the two ever drift apart, every measured width difference becomes a
 * fiction and the compensation puts the pen in the wrong place.
 */
function advanceOf(font: FontMap, code: number, run: ShowRun): number {
  const isWordBreak = font.codeBytes === 1 && code === 32;
  return (
    ((font.widthOf(code) / 1000) * run.size +
      run.charSpacing +
      (isWordBreak ? run.wordSpacing : 0)) *
    run.horizontal
  );
}

/**
 * Works out how to rewrite one occurrence, or why it cannot be rewritten.
 *
 * Nothing is changed here. The result is a byte edit the caller can apply,
 * inspect, or discard — which is what lets an interface show a reader what will
 * happen before it happens.
 */
export function planReplacement(
  scan: ScannedText,
  operations: readonly Operation[],
  occurrence: Occurrence,
  replacement: string,
  options: PlanOptions = {}
): Plan {
  const run = scan.runs[occurrence.run];
  const font = run.font;
  if (!font) return { ok: false, reason: 'split', missing: [] };

  if (run.operator !== 'Tj' && run.operator !== 'TJ') {
    // `'` and `"` also move to the next line, so rewriting them as a TJ would
    // silently drop that move. They are rare enough to refuse rather than
    // half-support.
    return { ok: false, reason: 'unsupported-operator', missing: [] };
  }

  const glyphs = run.glyphs.slice(occurrence.firstGlyph, occurrence.lastGlyph + 1);
  if (glyphs.some((glyph) => glyph.text === UNREADABLE)) {
    return { ok: false, reason: 'unreadable', missing: [] };
  }

  // --- can the font write it at all ----------------------------------------
  const codes: number[] = [];
  const missing: string[] = [];
  for (const character of replacement) {
    const code = font.fromUnicode.get(character);
    if (code === undefined) {
      if (!missing.includes(character)) missing.push(character);
      continue;
    }
    codes.push(code);
  }
  if (missing.length > 0) return { ok: false, reason: 'missing-glyphs', missing };

  // --- take the operation apart ---------------------------------------------
  //
  // Split into what comes before the word, the word, and what comes after,
  // rather than one array with the new codes dropped in. The reason is `Tz`: it
  // is a text-state operator and applies to a whole show operator, so a squeeze
  // written around a rebuilt array would scale the entire line. That was the
  // first version, and on a document whose generator draws a paragraph with one
  // `Tj` it moved everything after the edited word by eighteen points, which is
  // what the test for «the line does not move» is there to catch.
  const operation = operations[run.operation];
  const before: string[] = [];
  const after: string[] = [];
  /** How far the kerning inside the old word moved the pen, in text space. */
  let innerKerning = 0;

  const original = operation.operands[0];
  const items = original?.kind === 'array' ? original.items : original ? [original] : [];

  let glyphIndex = 0;
  for (const item of items) {
    if (item.kind === 'number') {
      // Kerning that lived inside the old word goes with the old word.
      const inside = glyphIndex > occurrence.firstGlyph && glyphIndex <= occurrence.lastGlyph;
      if (inside) {
        innerKerning += (-item.value / 1000) * run.size * run.horizontal;
        continue;
      }
      (glyphIndex <= occurrence.firstGlyph ? before : after).push(formatNumber(item.value));
      continue;
    }
    if (item.kind !== 'string') continue;

    const count = Math.floor(item.bytes.length / font.codeBytes);
    const leading: number[] = [];
    const trailing: number[] = [];
    for (let order = 0; order < count; order += 1) {
      const index = glyphIndex + order;
      const code = run.glyphs[index]?.code;
      if (code === undefined) continue;
      if (index < occurrence.firstGlyph) leading.push(code);
      else if (index > occurrence.lastGlyph) trailing.push(code);
    }
    if (leading.length > 0) before.push(`<${hexOf(leading, font.codeBytes)}>`);
    if (trailing.length > 0) after.push(`<${hexOf(trailing, font.codeBytes)}>`);
    glyphIndex += count;
  }

  // --- measure --------------------------------------------------------------
  //
  // Measured the same way the scan measured the glyphs being replaced: the
  // font's width, plus character spacing, plus word spacing for a real space,
  // all multiplied by the horizontal scale.
  //
  // Plus the kerning that lived inside the word, which is not optional and is
  // easy to forget, because a glyph's advance does not include it. TeX writes
  // «Tratado» as (T) 94 (ratado): the 94 pulls the pair almost two points
  // closer at that size, so a replacement measured without it comes out two
  // points too wide, and everything after it on the line moves by that much
  // under a fit that promised nothing would move.
  const oldWidth =
    glyphs.reduce((total, glyph) => total + glyph.advance, 0) + innerKerning;
  const naturalWidth = codes.reduce((total, code) => total + advanceOf(font, code, run), 0);

  const fit = options.fit ?? 'squeeze';
  const maxScale = options.maxScale ?? 2;
  let horizontalScale = run.horizontal * 100;
  let widthDelta = naturalWidth - oldWidth;

  if (fit === 'squeeze' && naturalWidth > 0 && oldWidth > 0) {
    const ratio = oldWidth / naturalWidth;
    if (ratio > maxScale || ratio < 1 / maxScale) {
      return { ok: false, reason: 'too-different', missing: [], ratio };
    }
    // `Tz` sets the scale outright rather than multiplying it, so the run's own
    // scale has to be carried into the number written — and put back after.
    horizontalScale = run.horizontal * ratio * 100;
    widthDelta = 0;
  }

  const word = `<${hexOf(codes, font.codeBytes)}>`;
  const showBefore = before.length > 0 ? `[${before.join(' ')}] TJ ` : '';
  const showAfter = after.length > 0 ? ` [${after.join(' ')}] TJ` : '';

  let text: string;
  if (fit === 'squeeze' && widthDelta === 0 && naturalWidth > 0 && oldWidth > 0) {
    // The scale wraps the word and nothing else, and is put back immediately —
    // leaving it set would apply it to every later run in the text object.
    text =
      `${showBefore}${formatNumber(horizontalScale)} Tz [${word}] TJ ` +
      `${formatNumber(run.horizontal * 100)} Tz${showAfter}`;
  } else if (fit === 'keep-layout' && widthDelta !== 0) {
    // Give the difference back so nothing after the word moves. A POSITIVE
    // number in a TJ array moves the pen left, so a word that came out wider
    // needs a positive one to pull the pen back to where the old one ended.
    const adjustment = (widthDelta / (run.size * run.horizontal || 1)) * 1000;
    text = `${showBefore}[${word} ${formatNumber(adjustment)}] TJ${showAfter}`;
  } else {
    // `keep-flow`, or a replacement that happened to measure the same.
    text = `${showBefore}[${word}] TJ${showAfter}`;
  }

  return {
    ok: true,
    occurrence,
    edit: { start: operation.start, end: operation.end, replacement: asciiBytes(text) },
    widthDelta: fit === 'keep-layout' ? 0 : widthDelta,
    naturalWidthDelta: naturalWidth - oldWidth,
    horizontalScale,
    fit,
  };
}

/** Applies planned edits to a stream. Overlapping plans are rejected by the splice. */
export function applyPlans(stream: Uint8Array, plans: readonly PlannedEdit[]): Uint8Array {
  return spliceBytes(
    stream,
    plans.map((plan) => plan.edit)
  );
}
