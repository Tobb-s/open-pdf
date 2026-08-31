import type { ToolSlug } from '@/lib/tools';

/**
 * What each tool does to everything that lives outside the page tree.
 *
 * A PDF carries more than pages: a form, bookmarks, attachments, page labels,
 * a title, a language. There are two ways to produce a file here and they
 * differ entirely in what happens to those.
 *
 * Editing the opened document — load it, change it, save it — keeps them.
 * Assembling a new one with `copyPages` keeps none: `copyPages` copies pages,
 * not documents, and no flag changes that. Split did the second while claiming
 * nothing, and asking for every page of a five-page file came back a quarter
 * smaller with six things missing, under a green tick.
 *
 * The table is a `Record` over every slug on purpose: adding a tool does not
 * compile until someone has said which it is, and the tests hold each answer
 * against what the tool actually produces. Two entries here were wrong on the
 * first attempt and the tests are what said so — `batch` was filed as a rebuild
 * when it edits in place, and two converters were asked to confess losses they
 * cannot have, because nothing they are handed is a PDF.
 */
export type StructurePromise =
  /** Edits the opened document. Everything outside the page tree survives. */
  | 'preserves'
  /** Builds a new document from copied pages. Nothing outside them comes. */
  | 'rebuilds'
  /**
   * The question does not arise, because one end is not a PDF: either nothing
   * with structures went in, or nothing with structures comes out.
   */
  | 'not-applicable';

export const TOOL_STRUCTURES: Record<ToolSlug, StructurePromise> = {
  // Load, change, save. The document that comes out is the one that went in.
  organize: 'preserves',
  edit: 'preserves',
  'fill-form': 'preserves',
  watermark: 'preserves',
  'page-numbers': 'preserves',
  studio: 'preserves',
  batch: 'preserves',
  // Split trims the original when it can, and only assembles a new document
  // when the selection repeats a page — which it then says.
  split: 'preserves',

  // Assembled from copied pages, so nothing outside them survives.
  merge: 'rebuilds',
  compress: 'rebuilds',
  ocr: 'rebuilds',

  // One end is not a PDF: images or an Office file going in, images or a .docx
  // coming out. There are no structures to lose.
  'pdf-to-word': 'not-applicable',
  'image-pdf': 'not-applicable',
  'office-to-pdf': 'not-applicable',
};

/**
 * Whether a tool owes the reader a sentence about what it gave up.
 *
 * Only the ones that rebuild a PDF from another PDF. A tool that edits in place
 * has nothing to confess, and one handed a Word file never had a form to lose —
 * a warning that is not true is what teaches readers to skip the ones that are.
 */
export function mustReportLosses(slug: ToolSlug): boolean {
  return TOOL_STRUCTURES[slug] === 'rebuilds';
}
