import { EncryptedPDFError } from 'pdf-lib';
import type { Dictionary } from '@/lib/i18n/dictionaries';

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

/**
 * Thrown by the tools themselves when they can name the problem precisely.
 *
 * The title and detail are already translated by the caller, which has the
 * dictionary in hand.
 */
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
 * the reader what happened and what to do about it, in their language.
 */
export function describeError(error: unknown, t: Dictionary): ToolError {
  const messages = t.errors;

  if (error instanceof KnownToolError) {
    return { kind: error.kind, title: error.message, detail: error.detail };
  }

  const encrypted: ToolError = {
    kind: 'encrypted',
    title: messages.encryptedTitle,
    detail: messages.encryptedBody,
  };

  if (error instanceof EncryptedPDFError) return encrypted;

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
    return encrypted;
  }

  if (PDFJS_INVALID_ERRORS.has(name) || /invalid pdf|failed to parse|no pdf header/i.test(message)) {
    return { kind: 'invalid', title: messages.invalidTitle, detail: messages.invalidBody };
  }

  if (/fetch|network|load failed|importScripts|worker/i.test(message)) {
    return { kind: 'assets', title: messages.assetsTitle, detail: messages.assetsBody };
  }

  if (/detached|out of memory|allocation|maximum call stack/i.test(message)) {
    return { kind: 'too-large', title: messages.memoryTitle, detail: messages.memoryBody };
  }

  return {
    kind: 'unknown',
    title: messages.unknownTitle,
    detail: message || messages.unknownBody,
  };
}
