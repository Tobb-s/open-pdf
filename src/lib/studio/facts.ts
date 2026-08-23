import {
  EncryptedPDFError,
  PDFCheckBox,
  PDFDropdown,
  PDFName,
  PDFRadioGroup,
  PDFTextField,
} from 'pdf-lib';
import { loadPdf } from '@/lib/pdfio';
import type { Metadata } from '@/lib/studio/script';
import { summarizeStructures } from '@/lib/verify/structural';

/**
 * What the opened document already says: its form, its metadata, whether it
 * was signed.
 *
 * Read once when a file is chosen, before the editor is running, because it
 * is the only way to show the reader what is there before they change it —
 * and because it is the moment a document that cannot be edited at all has to
 * be refused, rather than a session built around it.
 */

export interface FormFieldInfo {
  name: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'radio';
  /** What the document itself says, before the reader changes anything. */
  original: string;
  options?: string[];
}

export interface DocumentFacts {
  fields: FormFieldInfo[];
  metadata: Metadata;
  /** True when the document carries a digital signature that any save will break. */
  signed: boolean;
}

/** A refusal that has to reach the reader, not be absorbed into "no form". */
function isEncryptionError(caught: unknown): boolean {
  if (caught instanceof EncryptedPDFError) return true;
  // Class identity is not dependable across bundles; pdf-lib's own text is.
  return caught instanceof Error && /is encrypted/i.test(caught.message);
}

export async function readDocumentFacts(bytes: Uint8Array): Promise<DocumentFacts> {
  let document;
  try {
    document = await loadPdf(bytes, { updateMetadata: false });
  } catch (caught) {
    // This used to be swallowed with everything else, and it was the one
    // failure that must not be. pdf.js opens a document whose only password is
    // the owner's without complaint, so the door let it in; pdf-lib — which is
    // what every rebuild runs on — refuses it. Absorbing that here meant the
    // session was created and the first rebuild failed inside the worker, with
    // the reader already sat in front of an editor that could not edit.
    if (isEncryptionError(caught)) throw caught;
    // Anything else pdf-lib will not read: nothing to show, and the run itself
    // reports the file properly if it cannot be used.
    return { fields: [], metadata: {}, signed: false };
  }

  try {
    const language = document.catalog.get(PDFName.of('Lang'));
    const metadata: Metadata = {
      title: document.getTitle() ?? '',
      author: document.getAuthor() ?? '',
      language: language ? String(language).replace(/^\(|\)$/g, '') : '',
    };

    const found: FormFieldInfo[] = [];
    for (const field of document.getForm().getFields()) {
      const name = field.getName();
      if (field instanceof PDFTextField) {
        found.push({ name, type: 'text', original: field.getText() ?? '' });
      } else if (field instanceof PDFCheckBox) {
        found.push({ name, type: 'checkbox', original: field.isChecked() ? 'true' : 'false' });
      } else if (field instanceof PDFDropdown) {
        // `getOptions` returns what a reader sees and `getSelected` returns
        // what the file stores; on a document that gives them different words
        // the two do not line up, so the options carry the stored values.
        found.push({
          name,
          type: 'dropdown',
          original: field.getSelected()[0] ?? '',
          options: field.acroField.getOptions().map((option) => option.value.decodeText()),
        });
      } else if (field instanceof PDFRadioGroup) {
        found.push({
          name,
          type: 'radio',
          original: field.getSelected() ?? '',
          options: field.getOptions(),
        });
      }
    }

    // Read here rather than at export, and the difference is the whole point:
    // someone who signed a contract has to know BEFORE an afternoon of work
    // that saving will break the signature, not after.
    const signed = summarizeStructures(document).categories.signatures > 0;

    return { fields: found, metadata, signed };
  } catch {
    // A form too damaged to walk: the document still opens, so the session
    // goes ahead with nothing in the panel.
    return { fields: [], metadata: {}, signed: false };
  }
}
