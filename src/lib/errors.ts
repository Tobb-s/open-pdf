import { EncryptedPDFError } from 'pdf-lib';

export type ToolErrorKind =
  | 'encrypted'
  | 'invalid'
  | 'unsupported-image'
  | 'too-large'
  | 'assets'
  | 'cancelled'
  | 'unknown';

export interface ToolError {
  kind: ToolErrorKind;
  title: string;
  detail: string;
}

/** Thrown by the tools themselves when they can name the problem precisely. */
export class KnownToolError extends Error {
  readonly kind: ToolErrorKind;
  readonly detail: string;

  constructor(kind: ToolErrorKind, title: string, detail: string) {
    super(title);
    this.name = 'KnownToolError';
    this.kind = kind;
    this.detail = detail;
  }
}

const PDFJS_PASSWORD_ERRORS = new Set(['PasswordException']);
const PDFJS_INVALID_ERRORS = new Set(['InvalidPDFException', 'UnknownErrorException']);

/**
 * Turns whatever pdf-lib, pdf.js or the network threw into a message that tells
 * the reader what happened and what to do about it.
 */
export function describeError(error: unknown): ToolError {
  if (error instanceof KnownToolError) {
    return { kind: error.kind, title: error.message, detail: error.detail };
  }

  if (error instanceof EncryptedPDFError) {
    return {
      kind: 'encrypted',
      title: 'This PDF is password-protected',
      detail:
        'OpenPDF cannot open encrypted documents. Remove the password in your PDF reader, save a copy, and try again.',
    };
  }

  const name = error instanceof Error ? error.name : '';
  const constructorName = (error as { constructor?: { name?: string } })?.constructor?.name;
  const message = error instanceof Error ? error.message : String(error);

  // Matched by message as well as by type: pdf-lib's own text says "encrypted"
  // and never "password", and the class identity is not dependable once the app
  // is bundled into separate chunks.
  if (
    PDFJS_PASSWORD_ERRORS.has(name) ||
    constructorName === 'EncryptedPDFError' ||
    /password|is encrypted/i.test(message)
  ) {
    return {
      kind: 'encrypted',
      title: 'This PDF is password-protected',
      detail:
        'OpenPDF cannot open encrypted documents. Remove the password in your PDF reader, save a copy, and try again.',
    };
  }

  if (PDFJS_INVALID_ERRORS.has(name) || /invalid pdf|failed to parse|no pdf header/i.test(message)) {
    return {
      kind: 'invalid',
      title: 'This file is not a readable PDF',
      detail:
        'The file may be damaged, incomplete, or saved in another format with a .pdf name. Try re-exporting it from the program that created it.',
    };
  }

  if (/fetch|network|load failed|importScripts|worker/i.test(message)) {
    return {
      kind: 'assets',
      title: 'Could not load the PDF engine',
      detail:
        'The processing code failed to load. Check your connection and reload the page — everything runs locally once it has loaded.',
    };
  }

  if (/detached|out of memory|allocation|maximum call stack/i.test(message)) {
    return {
      kind: 'too-large',
      title: 'The browser ran out of memory',
      detail:
        'This document is too large to process in one pass. Split it into smaller parts and try again.',
    };
  }

  return {
    kind: 'unknown',
    title: 'Something went wrong',
    detail: message || 'No further detail is available. The browser console may have more.',
  };
}
