import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFObject,
  PDFRef,
  PDFString,
} from 'pdf-lib';
import { loadPdf } from '@/lib/pdfio';

/**
 * What a PDF carries besides its pages.
 *
 * These are the things `copyPages` into a fresh document silently strips —
 * measured: a fixture with a form, bookmarks, an attachment and a language tag
 * came out of the old rebuild path with none of them. A tool that hands back a
 * document must be able to say which of these survived.
 */
export type StructureCategory =
  | 'form'
  | 'bookmarks'
  | 'attachments'
  | 'pageLabels'
  | 'layers'
  | 'accessibility'
  | 'metadataTitle'
  | 'language';

export const STRUCTURE_CATEGORIES: readonly StructureCategory[] = [
  'form',
  'bookmarks',
  'attachments',
  'pageLabels',
  'layers',
  'accessibility',
  'metadataTitle',
  'language',
];

/**
 * Categories whose survival this module can actually vouch for.
 *
 * Forms and bookmarks are counted against the LIVE pages — a field whose only
 * widget sat on a deleted page is dead, and a bookmark whose destination page is
 * gone is dead — so a drop in their count is a real, detectable loss.
 * Attachments, title and language are document-level and independent of pages.
 * Page labels are dropped by the editor the moment the page sequence changes
 * (they bind to page indices, which reordering invalidates), so their presence
 * afterwards means they are still valid.
 *
 * Layers (OCProperties) and accessibility (StructTreeRoot) are deliberately
 * OUTSIDE this set: after a page deletion their internals may reference content
 * that no longer exists, and this module cannot tell a live tag tree from a
 * broken one. Their TOTAL loss is still reported; their SURVIVAL is never
 * claimed, because a claim we cannot verify is exactly what this app must not
 * make.
 */
export const VERIFIABLE_CATEGORIES: readonly StructureCategory[] = [
  'form',
  'bookmarks',
  'attachments',
  'pageLabels',
  'metadataTitle',
  'language',
];

export interface StructuralSummary {
  pageCount: number;
  /** Count per category: live fields, live bookmarks, attachments, or 0/1 presence. */
  categories: Record<StructureCategory, number>;
}

export interface StructuralLoss {
  category: StructureCategory;
  before: number;
  after: number;
}

function resolve(doc: PDFDocument, value: PDFObject | undefined): PDFObject | undefined {
  if (value instanceof PDFRef) return doc.context.lookup(value);
  return value;
}

function asDict(doc: PDFDocument, value: PDFObject | undefined): PDFDict | undefined {
  const resolved = resolve(doc, value);
  return resolved instanceof PDFDict ? resolved : undefined;
}

function asArray(doc: PDFDocument, value: PDFObject | undefined): PDFArray | undefined {
  const resolved = resolve(doc, value);
  return resolved instanceof PDFArray ? resolved : undefined;
}

/** Refs of the pages currently in the page tree. */
function livePageTags(doc: PDFDocument): Set<string> {
  return new Set(doc.getPages().map((page) => page.ref.tag));
}

/**
 * Refs of every annotation attached to a live page. Inline annotation dicts have
 * no ref of their own and are skipped — a field widget worth tracking is an
 * indirect object.
 */
function liveAnnotationTags(doc: PDFDocument): Set<string> {
  const tags = new Set<string>();
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index += 1) {
      const entry = annots.get(index);
      if (entry instanceof PDFRef) tags.add(entry.tag);
    }
  }
  return tags;
}

/**
 * A field is live if it, or any descendant widget, is attached to a live page.
 * A field that only ever had widgets on a page that was deleted shows nowhere
 * and must not be reported as surviving.
 */
function isFieldLive(
  doc: PDFDocument,
  entry: PDFObject | undefined,
  liveAnnots: Set<string>,
  depth: number
): boolean {
  if (!entry || depth > 16) return false;
  if (entry instanceof PDFRef && liveAnnots.has(entry.tag)) return true;

  const dict = asDict(doc, entry);
  if (!dict) return false;
  const kids = asArray(doc, dict.get(PDFName.of('Kids')));
  if (!kids) return false;
  for (let index = 0; index < kids.size(); index += 1) {
    if (isFieldLive(doc, kids.get(index), liveAnnots, depth + 1)) return true;
  }
  return false;
}

function countLiveFields(doc: PDFDocument, acroForm: PDFDict): number {
  const fields = asArray(doc, acroForm.get(PDFName.of('Fields')));
  if (!fields) return 0;
  const liveAnnots = liveAnnotationTags(doc);
  let count = 0;
  for (let index = 0; index < fields.size(); index += 1) {
    if (isFieldLive(doc, fields.get(index), liveAnnots, 0)) count += 1;
  }
  return count;
}

/** Reads a name-tree value (Names array or Kids subtrees) into `out`, keyed by string. */
function walkNameTree(
  doc: PDFDocument,
  node: PDFDict | undefined,
  out: Map<string, PDFObject>,
  depth = 0
): void {
  if (!node || depth > 16) return;
  const names = asArray(doc, node.get(PDFName.of('Names')));
  if (names) {
    for (let index = 0; index + 1 < names.size(); index += 2) {
      const key = names.get(index);
      const keyStr =
        key instanceof PDFString || key instanceof PDFHexString ? key.decodeText() : undefined;
      if (keyStr !== undefined) out.set(keyStr, names.get(index + 1));
    }
  }
  const kids = asArray(doc, node.get(PDFName.of('Kids')));
  if (kids) {
    for (let index = 0; index < kids.size(); index += 1) {
      walkNameTree(doc, asDict(doc, kids.get(index)), out, depth + 1);
    }
  }
}

/** The named-destination table (/Names/Dests plus the legacy /Dests dict). */
function namedDestinations(doc: PDFDocument): Map<string, PDFObject> {
  const table = new Map<string, PDFObject>();

  const namesDict = asDict(doc, doc.catalog.get(PDFName.of('Names')));
  walkNameTree(doc, namesDict && asDict(doc, namesDict.get(PDFName.of('Dests'))), table);

  const legacy = asDict(doc, doc.catalog.get(PDFName.of('Dests')));
  if (legacy) {
    for (const [name, value] of legacy.entries()) table.set(name.decodeText(), value);
  }
  return table;
}

/** The page ref a destination points at, or null if it cannot be resolved. */
function destinationPageTag(
  doc: PDFDocument,
  dest: PDFObject | undefined,
  named: Map<string, PDFObject>,
  depth = 0
): string | null {
  if (!dest || depth > 8) return null;

  // A named destination: look it up, then resolve the destination it names.
  if (dest instanceof PDFName) {
    return destinationPageTag(doc, named.get(dest.decodeText()), named, depth + 1);
  }
  if (dest instanceof PDFString || dest instanceof PDFHexString) {
    return destinationPageTag(doc, named.get(dest.decodeText()), named, depth + 1);
  }

  // A destination dict wraps its array under /D.
  const asDestDict = asDict(doc, dest);
  if (asDestDict) {
    return destinationPageTag(doc, asDestDict.get(PDFName.of('D')), named, depth + 1);
  }

  // The explicit form: [pageRef, /XYZ, ...]. The first element is the page.
  const array = asArray(doc, dest);
  if (array && array.size() > 0) {
    const first = array.get(0);
    return first instanceof PDFRef ? first.tag : null;
  }
  return null;
}

/**
 * Outline items whose destination still lands on a live page.
 *
 * Counted across the full tree (First/Next plus Down into /First), not just the
 * top level, because a deletion can orphan a nested bookmark while the top-level
 * ones stay valid. A bookmark whose destination cannot be resolved to a live
 * page is not counted — we only vouch for the ones we can trace.
 */
function countLiveBookmarks(doc: PDFDocument, outlines: PDFDict): number {
  const live = livePageTags(doc);
  const named = namedDestinations(doc);
  const visited = new Set<PDFDict>();
  let count = 0;

  const walk = (node: PDFDict | undefined, depth: number): void => {
    let current = node;
    while (current && !visited.has(current) && depth < 500) {
      visited.add(current);

      let destTag = destinationPageTag(doc, current.get(PDFName.of('Dest')), named);
      if (destTag === null) {
        const action = asDict(doc, current.get(PDFName.of('A')));
        if (action) destTag = destinationPageTag(doc, action.get(PDFName.of('D')), named);
      }
      if (destTag !== null && live.has(destTag)) count += 1;

      walk(asDict(doc, current.get(PDFName.of('First'))), depth + 1);
      current = asDict(doc, current.get(PDFName.of('Next')));
    }
  };

  walk(asDict(doc, outlines.get(PDFName.of('First'))), 0);
  return count;
}

/** Entries in the EmbeddedFiles name tree, flat or kid-nested. */
function countAttachments(doc: PDFDocument, node: PDFDict, depth = 0): number {
  if (depth > 8) return 0;
  const names = asArray(doc, node.get(PDFName.of('Names')));
  if (names) return Math.floor(names.size() / 2);
  const kids = asArray(doc, node.get(PDFName.of('Kids')));
  if (!kids) return 0;
  let total = 0;
  for (let index = 0; index < kids.size(); index += 1) {
    const kid = asDict(doc, kids.get(index));
    if (kid) total += countAttachments(doc, kid, depth + 1);
  }
  return total;
}

/**
 * Reads the summary WITHOUT mutating the document. In particular it never calls
 * `doc.getForm()`, which creates an empty AcroForm on documents that have none —
 * a verifier that edits what it verifies would be worse than no verifier.
 *
 * Each category is read defensively: a category that cannot be read counts as 0.
 * On the *after* side that over-reports loss, which is the safe direction; on the
 * *before* side it can under-report, which is the price of never throwing.
 */
export function summarizeStructures(doc: PDFDocument): StructuralSummary {
  const catalog = doc.catalog;
  const categories: Record<StructureCategory, number> = {
    form: 0,
    bookmarks: 0,
    attachments: 0,
    pageLabels: 0,
    layers: 0,
    accessibility: 0,
    metadataTitle: 0,
    language: 0,
  };

  try {
    const acroForm = asDict(doc, catalog.get(PDFName.of('AcroForm')));
    // Counted against live pages: a field whose widgets were all on deleted
    // pages is not "surviving", and an AcroForm dict with no live field at all
    // is not a form worth claiming.
    if (acroForm) categories.form = countLiveFields(doc, acroForm);
  } catch {
    // documented above: unreadable → 0
  }

  try {
    const outlines = asDict(doc, catalog.get(PDFName.of('Outlines')));
    if (outlines) categories.bookmarks = countLiveBookmarks(doc, outlines);
  } catch {
    // unreadable → 0
  }

  try {
    const namesDict = asDict(doc, catalog.get(PDFName.of('Names')));
    const embedded = namesDict && asDict(doc, namesDict.get(PDFName.of('EmbeddedFiles')));
    if (embedded) categories.attachments = countAttachments(doc, embedded);
  } catch {
    // unreadable → 0
  }

  try {
    categories.pageLabels = asDict(doc, catalog.get(PDFName.of('PageLabels'))) ? 1 : 0;
  } catch {
    // unreadable → 0
  }
  try {
    categories.layers = asDict(doc, catalog.get(PDFName.of('OCProperties'))) ? 1 : 0;
  } catch {
    // unreadable → 0
  }
  try {
    categories.accessibility = asDict(doc, catalog.get(PDFName.of('StructTreeRoot'))) ? 1 : 0;
  } catch {
    // unreadable → 0
  }
  try {
    categories.metadataTitle = doc.getTitle() !== undefined ? 1 : 0;
  } catch {
    // unreadable → 0
  }
  try {
    categories.language = catalog.get(PDFName.of('Lang')) !== undefined ? 1 : 0;
  } catch {
    // unreadable → 0
  }

  return { pageCount: doc.getPageCount(), categories };
}

/** Categories the input had that the output has less of. Page count is the caller's business. */
export function diffStructures(
  before: StructuralSummary,
  after: StructuralSummary
): StructuralLoss[] {
  const losses: StructuralLoss[] = [];
  for (const category of STRUCTURE_CATEGORIES) {
    const b = before.categories[category];
    const a = after.categories[category];
    if (b > 0 && a < b) losses.push({ category, before: b, after: a });
  }
  return losses;
}

export interface StructuralReport {
  /**
   * Categories the input carried AND whose survival this module can vouch for.
   * Presence-only categories (layers, accessibility) are excluded even when the
   * input had them, so the "kept" line never claims something it cannot verify.
   */
  present: StructureCategory[];
  /** The subset of the input's categories the output has less of. */
  losses: StructuralLoss[];
}

/**
 * The full before/after story for a tool's result card: what the document had
 * that we can vouch for, and what of it the produced bytes kept.
 */
export async function reportStructures(
  before: Uint8Array,
  after: Uint8Array
): Promise<StructuralReport> {
  const [beforeDoc, afterDoc] = await Promise.all([
    loadPdf(before, { updateMetadata: false }),
    loadPdf(after, { updateMetadata: false }),
  ]);
  const beforeSummary = summarizeStructures(beforeDoc);
  const afterSummary = summarizeStructures(afterDoc);
  return {
    present: VERIFIABLE_CATEGORIES.filter((category) => beforeSummary.categories[category] > 0),
    losses: diffStructures(beforeSummary, afterSummary),
  };
}

/** Convenience for callers holding bytes rather than parsed documents. */
export async function compareStructureBytes(
  before: Uint8Array,
  after: Uint8Array
): Promise<StructuralLoss[]> {
  return (await reportStructures(before, after)).losses;
}
