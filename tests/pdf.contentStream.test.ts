import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { parseOperations, spliceBytes, type Operand } from '@/lib/pdf/contentStream';

const bytesOf = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff);
const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/** The codes of the first string operand, as a latin-1 string, for readability. */
const stringAt = (operand: Operand | undefined): string =>
  operand && operand.kind === 'string' ? latin1(operand.bytes) : '<no es cadena>';

describe('reading the operators', () => {
  it('reads an operator with its operands', () => {
    const ops = parseOperations(bytesOf('1 0 0 1 20 100 Tm'));
    expect(ops).toHaveLength(1);
    expect(ops[0].operator).toBe('Tm');
    expect(ops[0].operands.map((o) => (o.kind === 'number' ? o.value : null))).toEqual([
      1, 0, 0, 1, 20, 100,
    ]);
  });

  it('reads hex strings, padding an odd digit count with a zero', () => {
    const ops = parseOperations(bytesOf('<48656C6C6F> Tj <414> Tj'));
    expect(stringAt(ops[0].operands[0])).toBe('Hello');
    // `414` is A then 4-padded-with-0, which is 0x40.
    expect([...(ops[1].operands[0] as Extract<Operand, { kind: 'string' }>).bytes]).toEqual([
      0x41, 0x40,
    ]);
  });

  it('reads literal strings with balanced inner parentheses', () => {
    const ops = parseOperations(bytesOf('(a (b) c) Tj'));
    expect(stringAt(ops[0].operands[0])).toBe('a (b) c');
  });

  it('reads the escapes, octal included', () => {
    // `\023` is how a LaTeX Computer Modern subset writes an accent; getting
    // this wrong silently corrupts every accented word in the document.
    const ops = parseOperations(bytesOf('(A\\023B\\n\\(\\\\\\101) Tj'));
    const bytes = [...(ops[0].operands[0] as Extract<Operand, { kind: 'string' }>).bytes];
    expect(bytes).toEqual([0x41, 0o23, 0x42, 0x0a, 0x28, 0x5c, 0o101]);
  });

  it('stops an octal escape at three digits', () => {
    // `\1011` is the octal 101 followed by a literal 1, not a four-digit value.
    const ops = parseOperations(bytesOf('(\\1011) Tj'));
    expect([...(ops[0].operands[0] as Extract<Operand, { kind: 'string' }>).bytes]).toEqual([
      0o101, 0x31,
    ]);
  });

  it('treats a backslash before a line break as a continuation', () => {
    const ops = parseOperations(bytesOf('(one\\\r\ntwo) Tj'));
    expect(stringAt(ops[0].operands[0])).toBe('onetwo');
  });

  it('reads a TJ array, keeping numbers and strings in order', () => {
    const ops = parseOperations(bytesOf('[(T) 94 (ratado) -375 (de)] TJ'));
    expect(ops[0].operator).toBe('TJ');
    const array = ops[0].operands[0] as Extract<Operand, { kind: 'array' }>;
    expect(array.kind).toBe('array');
    expect(
      array.items.map((item) =>
        item.kind === 'number' ? item.value : item.kind === 'string' ? latin1(item.bytes) : '?'
      )
    ).toEqual(['T', 94, 'ratado', -375, 'de']);
  });

  it('decodes the hash escape in a name', () => {
    const ops = parseOperations(bytesOf('/A#20B 12 Tf'));
    expect(ops[0].operands[0]).toMatchObject({ kind: 'name', name: 'A B' });
  });

  it('skips comments', () => {
    const ops = parseOperations(bytesOf('% Tj a comment with (parens)\n1 0 0 rg'));
    expect(ops.map((op) => op.operator)).toEqual(['rg']);
  });

  it('does not desynchronise on an inline image whose data contains EI', () => {
    // The payload holds the bytes `EI` mid-word and an unbalanced paren. A
    // tokeniser that reads the payload as operators loses the rest of the page.
    const stream = 'q BI /W 2 /H 2 ID xxEIxx(unbalanced EI\nQ 1 0 0 rg';
    const ops = parseOperations(bytesOf(stream));
    expect(ops.map((op) => op.operator)).toEqual(['q', 'BI', 'Q', 'rg']);
    expect(ops[1].inlineImage).toBeDefined();
  });

  it('never stalls on a stray delimiter', () => {
    const ops = parseOperations(bytesOf('] ) >> } 1 0 0 rg'));
    expect(ops.map((op) => op.operator)).toEqual(['rg']);
  });
});

describe('the byte spans', () => {
  const STREAM = 'q\nBT /F1 12 Tf 20 100 Td [(Ho) -30 (la)] TJ ET\nQ';

  it('points at exactly the bytes each operation came from', () => {
    const bytes = bytesOf(STREAM);
    const ops = parseOperations(bytes);
    const slices = ops.map((op) => latin1(bytes.subarray(op.start, op.end)));
    expect(slices).toEqual([
      'q',
      'BT',
      '/F1 12 Tf',
      '20 100 Td',
      '[(Ho) -30 (la)] TJ',
      'ET',
      'Q',
    ]);
  });

  it('points at exactly the bytes each operand came from', () => {
    const bytes = bytesOf(STREAM);
    const show = parseOperations(bytes).find((op) => op.operator === 'TJ')!;
    const array = show.operands[0] as Extract<Operand, { kind: 'array' }>;
    expect(array.items.map((item) => latin1(bytes.subarray(item.start, item.end)))).toEqual([
      '(Ho)',
      '-30',
      '(la)',
    ]);
  });
});

describe('splicing', () => {
  it('changes only the range it was given', () => {
    const original = bytesOf('abcdefghij');
    const out = spliceBytes(original, [{ start: 3, end: 5, replacement: bytesOf('XYZ') }]);
    expect(latin1(out)).toBe('abcXYZfghij');
  });

  it('applies several edits regardless of the order they arrive in', () => {
    const original = bytesOf('one two three');
    const out = spliceBytes(original, [
      { start: 8, end: 13, replacement: bytesOf('THREE') },
      { start: 0, end: 3, replacement: bytesOf('1') },
    ]);
    expect(latin1(out)).toBe('1 two THREE');
  });

  it('refuses overlapping edits rather than pick a winner', () => {
    expect(() =>
      spliceBytes(bytesOf('abcdef'), [
        { start: 1, end: 4, replacement: bytesOf('X') },
        { start: 3, end: 5, replacement: bytesOf('Y') },
      ])
    ).toThrow(/[Oo]verlapping/);
  });

  it('returns the original when there is nothing to do', () => {
    const original = bytesOf('untouched');
    expect(latin1(spliceBytes(original, []))).toBe('untouched');
  });
});

/**
 * The property that matters more than any single case.
 *
 * If parsing and splicing nothing gives back the same bytes, then every part of
 * the stream this parser does not understand is being copied rather than
 * reinterpreted — which is the whole reason it works on spans instead of
 * re-emitting operators.
 */
describe('a real document', () => {
  const REAL = 'C:/Users/tobia/.gemini/antigravity/scratch/quant_finance_paper/documento_quant.pdf';

  const pageStreams = async (path: string): Promise<Uint8Array[]> => {
    const document = await PDFDocument.load(new Uint8Array(readFileSync(path)), {
      ignoreEncryption: true,
    });
    const out: Uint8Array[] = [];
    for (const page of document.getPages()) {
      const contents = page.node.Contents();
      const streams: PDFRawStream[] = [];
      if (contents instanceof PDFArray) {
        for (let index = 0; index < contents.size(); index += 1) {
          const stream = page.node.context.lookup(contents.get(index));
          if (stream instanceof PDFRawStream) streams.push(stream);
        }
      } else if (contents instanceof PDFRawStream) {
        streams.push(contents);
      }
      for (const stream of streams) out.push(decodePDFRawStream(stream).decode());
    }
    return out;
  };

  it.skipIf(!existsSync(REAL))(
    'reads every page of a LaTeX document and gives the bytes back unchanged',
    async () => {
      const streams = await pageStreams(REAL);
      expect(streams.length).toBeGreaterThan(0);

      let showOperators = 0;
      for (const stream of streams) {
        const ops = parseOperations(stream);
        expect(ops.length).toBeGreaterThan(0);
        showOperators += ops.filter((op) => 'Tj TJ \' "'.split(' ').includes(op.operator)).length;

        // Splicing nothing must be the identity.
        expect(spliceBytes(stream, [])).toEqual(stream);

        // And each operation's span must re-read as that same operation, which
        // is what makes a splice of that span safe.
        for (const op of ops) {
          if (op.inlineImage) continue;
          const again = parseOperations(stream.subarray(op.start, op.end));
          expect(again).toHaveLength(1);
          expect(again[0].operator).toBe(op.operator);
        }
      }
      expect(showOperators).toBeGreaterThan(50);
    },
    120000
  );
});
