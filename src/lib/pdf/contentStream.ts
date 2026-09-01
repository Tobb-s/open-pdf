/**
 * Reading a page's content stream as operations, with the byte spans intact.
 *
 * Everything Studio does today draws on top of a page or replaces the page with
 * a picture of itself. Neither can change a word that is already there: the old
 * glyphs stay in the file underneath the patch, or the whole page stops being
 * text. To replace a word and leave a document that is still a document, the
 * operators that draw it have to be edited where they live.
 *
 * pdf-lib does not parse content streams. It has `PDFContentStream` for
 * building one out of operators and `PDFObjectParser` for objects in the file
 * body, but nothing that reads the little postfix language inside a stream.
 * pdf.js has one and will not lend it: its parser resolves fonts to its own
 * ids and hands back positions, never offsets into the bytes it read. So this
 * is written here.
 *
 * The one design decision worth stating: every operand and every operation
 * carries the half-open byte range it came from, and rewriting is done by
 * splicing those ranges. Nothing is re-serialised. A stream that has one word
 * changed comes out byte-identical everywhere else — the same compression
 * artefacts, the same odd spacing, the same generator quirks. That is not
 * tidiness. Re-emitting a stream from a parse is a bet that the parse
 * understood all of it, and this parser does not understand all of it: it
 * skips inline image payloads without decoding them and keeps dictionaries as
 * unread spans. Splicing means those parts are copied, not re-imagined.
 */

/** Whitespace, per the PDF specification's table of white-space characters. */
const isWhite = (byte: number): boolean =>
  byte === 0x00 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20;

/** The characters that end a token without being part of it. */
const isDelimiter = (byte: number): boolean =>
  byte === 0x28 || // (
  byte === 0x29 || // )
  byte === 0x3c || // <
  byte === 0x3e || // >
  byte === 0x5b || // [
  byte === 0x5d || // ]
  byte === 0x7b || // {
  byte === 0x7d || // }
  byte === 0x2f || // /
  byte === 0x25; // %

const isRegular = (byte: number): boolean => !isWhite(byte) && !isDelimiter(byte);

const hexValue = (byte: number): number => {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
};

export type Operand =
  | { kind: 'number'; value: number; start: number; end: number }
  | {
      kind: 'string';
      /**
       * The character codes, as they will be handed to the font.
       *
       * Deliberately bytes and not a string: what a code means depends entirely
       * on the font it is shown with, and a two-byte CID font's codes are not
       * characters at all. Decoding belongs to whoever knows the font.
       */
      bytes: Uint8Array;
      /** True for `(literal)` form, false for `<hex>`. Kept so a rewrite can answer in kind. */
      literal: boolean;
      start: number;
      end: number;
    }
  | { kind: 'name'; name: string; start: number; end: number }
  | { kind: 'array'; items: Operand[]; start: number; end: number }
  /** Left unparsed on purpose — no operator this cares about takes one. */
  | { kind: 'dict'; start: number; end: number }
  | { kind: 'bool'; value: boolean; start: number; end: number }
  | { kind: 'null'; start: number; end: number };

export interface Operation {
  operator: string;
  operands: readonly Operand[];
  /** Where the operation begins: its first operand, or the operator when it has none. */
  start: number;
  /** One past the last byte of the operator token. */
  end: number;
  /**
   * The raw payload of an inline image, for `BI`.
   *
   * Inline images are the one construct that can desynchronise a tokeniser:
   * between `ID` and `EI` the bytes are image data and may contain anything,
   * including sequences that look like operators. Recording the span means a
   * caller can skip it, and splicing means it is never rewritten.
   */
  inlineImage?: { start: number; end: number };
}

class Cursor {
  constructor(
    readonly bytes: Uint8Array,
    public at = 0
  ) {}

  get done(): boolean {
    return this.at >= this.bytes.length;
  }

  peek(offset = 0): number {
    return this.bytes[this.at + offset] ?? -1;
  }

  /** Advances past whitespace and comments, which are equivalent to whitespace. */
  skipTrivia(): void {
    for (;;) {
      while (!this.done && isWhite(this.peek())) this.at += 1;
      if (this.peek() !== 0x25) return; // %
      while (!this.done && this.peek() !== 0x0a && this.peek() !== 0x0d) this.at += 1;
    }
  }
}

function readName(cursor: Cursor): Operand {
  const start = cursor.at;
  cursor.at += 1; // the slash
  const codes: number[] = [];
  while (!cursor.done && isRegular(cursor.peek())) {
    let byte = cursor.peek();
    // `#41` is an escaped byte inside a name. Two hex digits, always.
    if (byte === 0x23) {
      const high = hexValue(cursor.peek(1));
      const low = hexValue(cursor.peek(2));
      if (high >= 0 && low >= 0) {
        byte = high * 16 + low;
        cursor.at += 2;
      }
    }
    codes.push(byte);
    cursor.at += 1;
  }
  return {
    kind: 'name',
    name: String.fromCharCode(...codes),
    start,
    end: cursor.at,
  };
}

function readLiteralString(cursor: Cursor): Operand {
  const start = cursor.at;
  cursor.at += 1; // the opening paren
  const out: number[] = [];
  let depth = 1;

  while (!cursor.done) {
    const byte = cursor.peek();
    cursor.at += 1;

    if (byte === 0x5c) {
      // A backslash. Everything the specification allows after one.
      const next = cursor.peek();
      cursor.at += 1;
      switch (next) {
        case 0x6e: out.push(0x0a); break; // n
        case 0x72: out.push(0x0d); break; // r
        case 0x74: out.push(0x09); break; // t
        case 0x62: out.push(0x08); break; // b
        case 0x66: out.push(0x0c); break; // f
        case 0x28: out.push(0x28); break; // (
        case 0x29: out.push(0x29); break; // )
        case 0x5c: out.push(0x5c); break; // backslash
        case 0x0d:
          // A backslash before an end of line is a line continuation and
          // contributes nothing. CRLF counts as one.
          if (cursor.peek() === 0x0a) cursor.at += 1;
          break;
        case 0x0a:
          break;
        default: {
          // One to three octal digits. This is how LaTeX writes its accented
          // glyphs — `\023` in a Computer Modern subset — so getting the
          // greedy-but-bounded read right is not a corner case.
          if (next >= 0x30 && next <= 0x37) {
            let value = next - 0x30;
            for (let taken = 1; taken < 3; taken += 1) {
              const digit = cursor.peek();
              if (digit < 0x30 || digit > 0x37) break;
              value = value * 8 + (digit - 0x30);
              cursor.at += 1;
            }
            out.push(value & 0xff);
          } else if (next >= 0) {
            // Any other escaped character stands for itself.
            out.push(next);
          }
        }
      }
      continue;
    }

    if (byte === 0x28) {
      // Balanced parentheses may appear unescaped, and the inner ones are part
      // of the string.
      depth += 1;
      out.push(byte);
      continue;
    }
    if (byte === 0x29) {
      depth -= 1;
      if (depth === 0) break;
      out.push(byte);
      continue;
    }
    out.push(byte);
  }

  return { kind: 'string', bytes: Uint8Array.from(out), literal: true, start, end: cursor.at };
}

function readHexString(cursor: Cursor): Operand {
  const start = cursor.at;
  cursor.at += 1; // <
  const digits: number[] = [];
  while (!cursor.done && cursor.peek() !== 0x3e) {
    const value = hexValue(cursor.peek());
    if (value >= 0) digits.push(value);
    cursor.at += 1;
  }
  if (!cursor.done) cursor.at += 1; // >
  // An odd number of digits means the last byte is padded with a trailing zero.
  if (digits.length % 2 === 1) digits.push(0);
  const out = new Uint8Array(digits.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = digits[index * 2] * 16 + digits[index * 2 + 1];
  }
  return { kind: 'string', bytes: out, literal: false, start, end: cursor.at };
}

function readDict(cursor: Cursor): Operand {
  const start = cursor.at;
  cursor.at += 2; // <<
  let depth = 1;
  while (!cursor.done && depth > 0) {
    if (cursor.peek() === 0x3c && cursor.peek(1) === 0x3c) {
      depth += 1;
      cursor.at += 2;
      continue;
    }
    if (cursor.peek() === 0x3e && cursor.peek(1) === 0x3e) {
      depth -= 1;
      cursor.at += 2;
      continue;
    }
    // A string inside the dictionary can hold anything, `>>` included, so it
    // has to be consumed rather than scanned past.
    if (cursor.peek() === 0x28) {
      readLiteralString(cursor);
      continue;
    }
    cursor.at += 1;
  }
  return { kind: 'dict', start, end: cursor.at };
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** Reads one operand, or returns the bare keyword token that ends an operation. */
function readToken(cursor: Cursor): { operand?: Operand; keyword?: string; start: number; end: number } | null {
  cursor.skipTrivia();
  if (cursor.done) return null;
  const start = cursor.at;
  const byte = cursor.peek();

  if (byte === 0x2f) {
    const operand = readName(cursor);
    return { operand, start, end: cursor.at };
  }
  if (byte === 0x28) {
    const operand = readLiteralString(cursor);
    return { operand, start, end: cursor.at };
  }
  if (byte === 0x3c) {
    const operand = cursor.peek(1) === 0x3c ? readDict(cursor) : readHexString(cursor);
    return { operand, start, end: cursor.at };
  }
  if (byte === 0x5b) {
    cursor.at += 1;
    const items: Operand[] = [];
    for (;;) {
      cursor.skipTrivia();
      if (cursor.done || cursor.peek() === 0x5d) {
        if (!cursor.done) cursor.at += 1;
        break;
      }
      const inner = readToken(cursor);
      if (!inner) break;
      // A keyword inside an array is malformed; drop it rather than loop.
      if (inner.operand) items.push(inner.operand);
    }
    return { operand: { kind: 'array', items, start, end: cursor.at }, start, end: cursor.at };
  }
  if (byte === 0x5d || byte === 0x3e || byte === 0x29 || byte === 0x7b || byte === 0x7d) {
    // A stray closing delimiter. Step over it so the walk cannot stall.
    cursor.at += 1;
    return { start, end: cursor.at };
  }

  // A regular token: a number, a keyword, or one of the three literals.
  while (!cursor.done && isRegular(cursor.peek())) cursor.at += 1;
  if (cursor.at === start) {
    cursor.at += 1;
    return { start, end: cursor.at };
  }
  const text = String.fromCharCode(...cursor.bytes.subarray(start, cursor.at));
  if (NUMBER.test(text)) {
    return { operand: { kind: 'number', value: Number(text), start, end: cursor.at }, start, end: cursor.at };
  }
  if (text === 'true' || text === 'false') {
    return {
      operand: { kind: 'bool', value: text === 'true', start, end: cursor.at },
      start,
      end: cursor.at,
    };
  }
  if (text === 'null') {
    return { operand: { kind: 'null', start, end: cursor.at }, start, end: cursor.at };
  }
  return { keyword: text, start, end: cursor.at };
}

/**
 * Finds the end of an inline image, starting just after its `ID` operator.
 *
 * The payload is raw bytes and is allowed to contain `EI`, so the only safe
 * reading is: a whitespace, then `EI`, then whitespace or the end of the
 * stream. Even that can be fooled by binary data, which is why the span is
 * recorded and skipped rather than interpreted.
 */
function findInlineImageEnd(bytes: Uint8Array, from: number): number {
  for (let at = from; at < bytes.length - 1; at += 1) {
    if (bytes[at] !== 0x45 || bytes[at + 1] !== 0x49) continue; // E I
    const before = at === 0 ? 0x20 : bytes[at - 1];
    const after = at + 2 >= bytes.length ? 0x20 : bytes[at + 2];
    if (isWhite(before) && (isWhite(after) || isDelimiter(after))) return at + 2;
  }
  return bytes.length;
}

/**
 * Parses a content stream into its operations.
 *
 * Never throws on malformed input. A content stream that cannot be read is a
 * stream whose operations cannot be edited, and the caller has to be able to
 * say that to the reader — an exception halfway through a page would only
 * hide how far the reading got.
 */
export function parseOperations(bytes: Uint8Array): Operation[] {
  const cursor = new Cursor(bytes);
  const operations: Operation[] = [];
  let operands: Operand[] = [];
  let operandStart = -1;

  while (!cursor.done) {
    const token = readToken(cursor);
    if (!token) break;

    if (token.operand) {
      if (operandStart < 0) operandStart = token.start;
      operands.push(token.operand);
      continue;
    }
    if (!token.keyword) continue;

    const operation: Operation = {
      operator: token.keyword,
      operands,
      start: operandStart < 0 ? token.start : operandStart,
      end: token.end,
    };

    if (token.keyword === 'BI') {
      // Everything from `BI` to `EI` is one unit. The dictionary entries
      // between `BI` and `ID` are read as ordinary tokens by the loop above in
      // the general case; here they are simply passed over with the payload.
      let scan = cursor.at;
      while (scan < bytes.length - 1) {
        if (bytes[scan] === 0x49 && bytes[scan + 1] === 0x44 && isWhite(bytes[scan - 1] ?? 0x20)) break; // ID
        scan += 1;
      }
      const end = findInlineImageEnd(bytes, Math.min(scan + 3, bytes.length));
      operation.inlineImage = { start: cursor.at, end };
      operation.end = end;
      cursor.at = end;
    }

    operations.push(operation);
    operands = [];
    operandStart = -1;
  }

  return operations;
}

/**
 * Replaces byte ranges in a stream, leaving everything else exactly as it was.
 *
 * Ranges must not overlap; they are applied in order of position, so the caller
 * can collect them in any order. This is the only way bytes are ever changed.
 */
export function spliceBytes(
  original: Uint8Array,
  edits: ReadonlyArray<{ start: number; end: number; replacement: Uint8Array }>
): Uint8Array {
  const ordered = [...edits].sort((a, b) => a.start - b.start);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].start < ordered[index - 1].end) {
      throw new Error('Overlapping edits would make the result depend on their order.');
    }
  }

  const grown = ordered.reduce(
    (total, edit) => total + edit.replacement.length - (edit.end - edit.start),
    original.length
  );
  const out = new Uint8Array(grown);
  let read = 0;
  let write = 0;
  for (const edit of ordered) {
    out.set(original.subarray(read, edit.start), write);
    write += edit.start - read;
    out.set(edit.replacement, write);
    write += edit.replacement.length;
    read = edit.end;
  }
  out.set(original.subarray(read), write);
  return out;
}
