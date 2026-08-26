import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import type { SanitizationSpec } from '@/lib/studio/script';

const COMMENT_SUBTYPES = new Set([
  'Text',
  'FreeText',
  'Highlight',
  'Underline',
  'StrikeOut',
  'Squiggly',
  'Stamp',
  'Ink',
  'Popup',
  'FileAttachment',
  'Sound',
]);

const dictionaryAt = (document: PDFDocument, value: unknown): PDFDict | undefined => {
  try {
    return document.context.lookup(value as never, PDFDict);
  } catch {
    return undefined;
  }
};

const nameAt = (dictionary: PDFDict, key: string): string => {
  const value = dictionary.get(PDFName.of(key));
  return value instanceof PDFName ? value.asString().replace(/^\//, '') : '';
};

const mayOwnAutomaticAction = (dictionary: PDFDict): boolean => {
  const type = nameAt(dictionary, 'Type');
  return (
    type === 'Annot' ||
    type === 'Page' ||
    dictionary.has(PDFName.of('FT')) ||
    (dictionary.has(PDFName.of('Title')) && dictionary.has(PDFName.of('Parent')))
  );
};

/** Removes selected hidden or active structures without flattening unrelated page content. */
export function sanitizeDocument(document: PDFDocument, spec: SanitizationSpec): void {
  const { context, catalog } = document;

  if (spec.metadata) {
    const info = dictionaryAt(document, context.trailerInfo.Info);
    if (info) {
      for (const key of info.keys()) info.delete(key);
    }
    catalog.delete(PDFName.of('Metadata'));
  }

  const names = dictionaryAt(document, catalog.get(PDFName.of('Names')));
  if (names && spec.attachments) names.delete(PDFName.of('EmbeddedFiles'));
  if (names && spec.actions) names.delete(PDFName.of('JavaScript'));

  if (spec.comments) {
    for (const page of document.getPages()) {
      const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      if (!annotations) continue;
      const kept = [];
      for (let index = 0; index < annotations.size(); index += 1) {
        const raw = annotations.get(index);
        const annotation = dictionaryAt(document, raw);
        const subtype = annotation?.get(PDFName.of('Subtype'));
        const name = subtype instanceof PDFName ? subtype.asString().replace(/^\//, '') : '';
        if (!COMMENT_SUBTYPES.has(name)) kept.push(raw);
      }
      if (kept.length === 0) page.node.delete(PDFName.of('Annots'));
      else page.node.set(PDFName.of('Annots'), context.obj(kept));
    }
  }

  if (spec.actions) {
    catalog.delete(PDFName.of('OpenAction'));
    catalog.delete(PDFName.of('AA'));
    for (const [, object] of context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict)) continue;
      if (mayOwnAutomaticAction(object)) {
        object.delete(PDFName.of('AA'));
        object.delete(PDFName.of('A'));
      }
      if (nameAt(object, 'S') === 'JavaScript') object.delete(PDFName.of('JS'));
    }
  }
}
