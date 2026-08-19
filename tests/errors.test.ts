import { describe, expect, it } from 'vitest';
import { EncryptedPDFError, PDFDocument } from 'pdf-lib';
import { describeError, KnownToolError } from '@/lib/errors';

describe('describeError', () => {
  it('names an encrypted document and says what to do', () => {
    const described = describeError(new EncryptedPDFError());
    expect(described.kind).toBe('encrypted');
    expect(described.title).toMatch(/password/i);
    expect(described.detail).toMatch(/remove the password/i);
  });

  it('recognises pdf.js password errors by name', () => {
    const error = new Error('No password given');
    error.name = 'PasswordException';
    expect(describeError(error).kind).toBe('encrypted');
  });

  it('recognises a file that is not really a PDF', async () => {
    // What pdf-lib actually throws for junk input, rather than a guessed message.
    const caught = await PDFDocument.load(new Uint8Array([1, 2, 3, 4])).catch(
      (error: unknown) => error
    );
    expect(describeError(caught).kind).toBe('invalid');
  });

  it('passes through a tool error unchanged', () => {
    const known = new KnownToolError('too-large', 'Too big', 'Split it up.');
    expect(describeError(known)).toEqual({
      kind: 'too-large',
      title: 'Too big',
      detail: 'Split it up.',
    });
  });

  it('flags a failure to load the engine as a loading problem', () => {
    expect(describeError(new Error('Failed to fetch the worker script')).kind).toBe('assets');
  });

  it('never produces an empty message', () => {
    for (const input of [new Error(''), 'plain string', null, undefined, 42]) {
      const described = describeError(input);
      expect(described.title.length).toBeGreaterThan(0);
      expect(described.detail.length).toBeGreaterThan(0);
    }
  });
});
