import type { Operand, Operation } from '@/lib/pdf/contentStream';
import type { FontMap } from '@/lib/pdf/fontMap';

/**
 * Walking a content stream the way a viewer does, and writing down where every
 * glyph landed.
 *
 * A content stream does not contain text. It contains instructions for a pen:
 * pick a font, put the pen somewhere, draw these codes, nudge left by 94
 * thousandths, draw these. To find a word one has to run the instructions and
 * watch what comes out — which is what this does, minus the drawing.
 *
 * Two things it records that a simple text extraction would not, both needed
 * for replacing rather than reading:
 *
 * The byte span of every glyph's code, so an edit can be aimed at exactly the
 * bytes that draw the word and nothing else.
 *
 * The advance each glyph contributes, so a replacement can be measured against
 * what it replaces. Text after the edited word only stays where it was if the
 * new word's width is known and the difference is given back.
 */

/**
 * Stands in for a glyph that is on the page but cannot be named.
 *
 * It happens, and the honest answer is neither to drop it nor to guess. A TeX
 * document's summation sign lives at code 0x50 of a maths font, and that font's
 * `/ToUnicode` does not describe it. pdf.js falls back to the standard encoding
 * and reports the letter P — so a find-and-replace built on pdf.js's reading
 * lets someone search for «P», match a Σ, and replace it. Dropping the glyph
 * instead would be quieter and just as wrong: the word on either side would
 * close up, and a match could then run straight through a character nobody saw.
 *
 * A character that can never equal anything a reader types is the only answer
 * that keeps both halves honest: the glyph stays counted and stays unmatchable.
 */
export const UNREADABLE = '�';

/** `[a b c d e f]`, the PDF's own order. */
export type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export interface Glyph {
  /** Index into the operation list this came from. */
  operation: number;
  /** Position within a `TJ` array, or -1 when the operator took a bare string. */
  element: number;
  /** Which code this is inside its string operand, counting codes and not bytes. */
  order: number;
  code: number;
  /** What the font says this code means. Empty when the font could not say. */
  text: string;
  /** Advance in unscaled text space, before the text matrix is applied. */
  advance: number;
  /** Where the pen was, in page space, before this glyph was drawn. */
  x: number;
  y: number;
}

export interface ShowRun {
  /** Index into the operation list. */
  operation: number;
  operator: 'Tj' | 'TJ' | "'" | '"';
  /** The resource name selected by the most recent `Tf`. */
  fontResource: string;
  font: FontMap | null;
  size: number;
  /** Render mode. Three means invisible, which is what a scan's text layer uses. */
  renderMode: number;
  /**
   * The spacing state in force, which a rewrite has to reproduce.
   *
   * A glyph's advance is not its width: character spacing is added to every
   * glyph, word spacing to single-byte code 32, and horizontal scaling
   * multiplies the lot. A replacement measured without them comes out the
   * wrong length in exactly the documents that set them.
   */
  charSpacing: number;
  wordSpacing: number;
  /** Horizontal scaling as a fraction, so `Tz 100` reads as 1. */
  horizontal: number;
  glyphs: Glyph[];
  /** Text matrix in effect when the run began. */
  matrix: Matrix;
  /** The transform in effect, so a caller can place a box on the page. */
  ctm: Matrix;
}

export interface ScannedText {
  runs: ShowRun[];
  /**
   * The page as a reader would read it, with the spaces that are not in the file.
   *
   * Between two words a document usually has no space character at all — it has
   * a number that moves the pen. Recovering the word break is a judgement, and
   * this is where it is made; `positions` maps each character of this string
   * back to the glyph it came from, or to null for a space that was inferred
   * and therefore corresponds to nothing in the file.
   */
  text: string;
  positions: Array<{ run: number; glyph: number } | null>;
}

interface TextState {
  font: string;
  size: number;
  charSpacing: number;
  wordSpacing: number;
  /** Horizontal scaling, as a fraction. `Tz 100` is 1. */
  horizontal: number;
  leading: number;
  rise: number;
  renderMode: number;
  ctm: Matrix;
}

const numbersOf = (operands: readonly Operand[]): number[] =>
  operands.filter((operand) => operand.kind === 'number').map((operand) => operand.value);

/** Splits a string operand into the codes its font reads it as. */
function codesOf(bytes: Uint8Array, codeBytes: number): number[] {
  const codes: number[] = [];
  for (let at = 0; at + codeBytes <= bytes.length; at += codeBytes) {
    let code = 0;
    for (let byte = 0; byte < codeBytes; byte += 1) code = code * 256 + bytes[at + byte];
    codes.push(code);
  }
  return codes;
}

/**
 * Runs the stream and collects every glyph that was drawn.
 *
 * Never throws. A stream with operators this does not know is walked past them:
 * an unknown operator cannot move the pen in a way that matters here, with the
 * one exception of `gs` naming a font in an external graphics state, which is
 * rare enough to be worth a wrong position rather than a refusal to read the
 * page at all. Callers that need certainty compare the text they found against
 * what pdf.js reads.
 */
export function scanText(
  operations: readonly Operation[],
  fonts: ReadonlyMap<string, FontMap>
): ScannedText {
  const runs: ShowRun[] = [];
  const stack: TextState[] = [];

  let state: TextState = {
    font: '',
    size: 0,
    charSpacing: 0,
    wordSpacing: 0,
    horizontal: 1,
    leading: 0,
    rise: 0,
    renderMode: 0,
    ctm: IDENTITY,
  };
  let textMatrix: Matrix = IDENTITY;
  let lineMatrix: Matrix = IDENTITY;

  const translateLine = (tx: number, ty: number) => {
    lineMatrix = multiply([1, 0, 0, 1, tx, ty], lineMatrix);
    textMatrix = lineMatrix;
  };

  const show = (operation: Operation, index: number, operand: Operand | undefined) => {
    const font = fonts.get(state.font) ?? null;
    const codeBytes = font?.codeBytes ?? 1;
    const glyphs: Glyph[] = [];
    const startMatrix = textMatrix;

    const drawString = (item: Operand, element: number) => {
      if (item.kind !== 'string') return;
      codesOf(item.bytes, codeBytes).forEach((code, order) => {
        const width = (font?.widthOf(code) ?? 0) / 1000;
        // Word spacing applies to the single byte 32 and to nothing else — in a
        // two-byte font the value 32 is a different glyph and must not get it.
        const isWordBreak = codeBytes === 1 && code === 32;
        const advance =
          (width * state.size + state.charSpacing + (isWordBreak ? state.wordSpacing : 0)) *
          state.horizontal;
        const place = multiply([1, 0, 0, 1, 0, state.rise], multiply(textMatrix, state.ctm));
        glyphs.push({
          operation: index,
          element,
          order,
          code,
          text: font?.toUnicode.get(code) ?? UNREADABLE,
          advance,
          x: place[4],
          y: place[5],
        });
        textMatrix = multiply([1, 0, 0, 1, advance, 0], textMatrix);
      });
    };

    if (operand?.kind === 'array') {
      operand.items.forEach((item, element) => {
        if (item.kind === 'number') {
          // A positive number moves the pen LEFT — tighter. This sign is the
          // one most often written the wrong way round, and getting it wrong
          // turns every kerned pair into an invented word break.
          const shift = (-item.value / 1000) * state.size * state.horizontal;
          textMatrix = multiply([1, 0, 0, 1, shift, 0], textMatrix);
          return;
        }
        drawString(item, element);
      });
    } else if (operand) {
      drawString(operand, -1);
    }

    runs.push({
      operation: index,
      operator: operation.operator as ShowRun['operator'],
      fontResource: state.font,
      font,
      size: state.size,
      renderMode: state.renderMode,
      charSpacing: state.charSpacing,
      wordSpacing: state.wordSpacing,
      horizontal: state.horizontal,
      glyphs,
      matrix: startMatrix,
      ctm: state.ctm,
    });
  };

  operations.forEach((operation, index) => {
    const numbers = numbersOf(operation.operands);

    switch (operation.operator) {
      case 'q':
        stack.push({ ...state });
        break;
      case 'Q': {
        const previous = stack.pop();
        if (previous) state = previous;
        break;
      }
      case 'cm':
        if (numbers.length >= 6) {
          state.ctm = multiply(numbers.slice(0, 6) as unknown as Matrix, state.ctm);
        }
        break;
      case 'BT':
        textMatrix = IDENTITY;
        lineMatrix = IDENTITY;
        break;
      case 'Tf': {
        const name = operation.operands.find((operand) => operand.kind === 'name');
        if (name?.kind === 'name') state.font = name.name;
        if (numbers.length > 0) state.size = numbers[numbers.length - 1];
        break;
      }
      case 'Td':
        if (numbers.length >= 2) translateLine(numbers[0], numbers[1]);
        break;
      case 'TD':
        if (numbers.length >= 2) {
          state.leading = -numbers[1];
          translateLine(numbers[0], numbers[1]);
        }
        break;
      case 'Tm':
        if (numbers.length >= 6) {
          lineMatrix = numbers.slice(0, 6) as unknown as Matrix;
          textMatrix = lineMatrix;
        }
        break;
      case 'T*':
        translateLine(0, -state.leading);
        break;
      case 'TL':
        if (numbers.length > 0) state.leading = numbers[0];
        break;
      case 'Tc':
        if (numbers.length > 0) state.charSpacing = numbers[0];
        break;
      case 'Tw':
        if (numbers.length > 0) state.wordSpacing = numbers[0];
        break;
      case 'Tz':
        if (numbers.length > 0) state.horizontal = numbers[0] / 100;
        break;
      case 'Ts':
        if (numbers.length > 0) state.rise = numbers[0];
        break;
      case 'Tr':
        if (numbers.length > 0) state.renderMode = numbers[0];
        break;
      case 'Tj':
        show(operation, index, operation.operands[0]);
        break;
      case 'TJ':
        show(operation, index, operation.operands[0]);
        break;
      case "'":
        translateLine(0, -state.leading);
        show(operation, index, operation.operands[operation.operands.length - 1]);
        break;
      case '"':
        if (numbers.length >= 2) {
          state.wordSpacing = numbers[0];
          state.charSpacing = numbers[1];
        }
        translateLine(0, -state.leading);
        show(operation, index, operation.operands[operation.operands.length - 1]);
        break;
      default:
        break;
    }
  });

  return assemble(runs);
}

/**
 * How wide a gap has to be before it counts as a space.
 *
 * Measured against the font's own space, when it has one: a document that puts
 * its words 40% of a space apart meant a space, and one that pulls two letters
 * 9% closer meant kerning. Without a space glyph to measure — which happens in
 * subsetted fonts that never drew one — a fifth of the font size stands in.
 */
function spaceThreshold(run: ShowRun): number {
  const spaceCode = run.font?.fromUnicode.get(' ');
  if (spaceCode !== undefined && run.font) {
    const width = run.font.widthOf(spaceCode) / 1000;
    if (width > 0) return width * run.size * 0.4;
  }
  return run.size * 0.2;
}

function assemble(runs: ShowRun[]): ScannedText {
  let text = '';
  const positions: ScannedText['positions'] = [];

  let previousEnd: { x: number; y: number; size: number } | null = null;

  runs.forEach((run, runIndex) => {
    const gap = spaceThreshold(run);

    // A run that starts on another line, or far to the right of where the last
    // one ended, is a new word — usually a new line.
    if (previousEnd && run.glyphs.length > 0) {
      const first = run.glyphs[0];
      const movedDown = Math.abs(first.y - previousEnd.y) > previousEnd.size * 0.5;
      const movedRight = first.x - previousEnd.x > gap;
      const movedBack = first.x < previousEnd.x - gap;
      if (movedDown) {
        text += '\n';
        positions.push(null);
      } else if (movedRight || movedBack) {
        text += ' ';
        positions.push(null);
      }
    }

    run.glyphs.forEach((glyph, glyphIndex) => {
      const previous = glyphIndex > 0 ? run.glyphs[glyphIndex - 1] : null;
      if (previous) {
        // Inside a run the pen only jumps when a TJ number moved it. The glyph
        // advance is already accounted for, so anything beyond it is the gap.
        const expected = previous.x + previous.advance;
        if (glyph.x - expected > gap) {
          text += ' ';
          positions.push(null);
        }
      }
      const piece = glyph.text;
      for (let at = 0; at < piece.length; at += 1) {
        positions.push({ run: runIndex, glyph: glyphIndex });
      }
      text += piece;
    });

    const last = run.glyphs[run.glyphs.length - 1];
    if (last) previousEnd = { x: last.x + last.advance, y: last.y, size: run.size };
  });

  return { runs, text, positions };
}
