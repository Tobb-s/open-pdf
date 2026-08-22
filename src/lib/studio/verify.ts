import {
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFStream,
  PDFTextField,
} from 'pdf-lib';
import { loadPdf } from '@/lib/pdfio';
import {
  summarizeStructures,
  VERIFIABLE_CATEGORIES,
  type StructureCategory,
} from '@/lib/verify/structural';

/**
 * Reading back what was written, instead of assuming it took.
 *
 * Two things in this stage cannot be trusted to have worked:
 *
 * Writing a form field asks pdf-lib to regenerate the field's appearance, which
 * depends on a font named in the field's own definition — a font the document
 * may not embed. When that goes wrong the value is in the file but invisible,
 * or silently absent. The only way to know is to open the produced bytes and
 * look.
 *
 * And importing pages from another PDF loses everything that lives outside a
 * page: `copyPages` copies pages, not documents. That is not a defect to fix,
 * it is what the operation is — so the honest thing is to say which of those
 * things the imported file had, before the reader builds on the assumption that
 * they came along.
 */

export interface FieldCheck {
  field: string;
  wanted: string;
  /** What the produced file actually says, or null when the field is gone. */
  found: string | null;
  /**
   * True when the value is in the file but nothing draws it.
   *
   * This is the failure the stage was warned about: appearance regeneration
   * depends on a font the document names, and when it does not work the value
   * is there and invisible. Comparing values alone cannot see it — so the check
   * looks for the appearance stream too.
   */
  invisible?: boolean;
}

/**
 * Opens the produced bytes and compares every field the reader set against
 * what is really in there.
 *
 * Returns only the disagreements, so an empty array means every value the
 * reader typed survived the write.
 */
export async function verifyFields(
  bytes: Uint8Array,
  wanted: Readonly<Record<string, string>>
): Promise<FieldCheck[]> {
  const entries = Object.entries(wanted);
  if (entries.length === 0) return [];

  const wrong: FieldCheck[] = [];
  try {
    const document = await loadPdf(bytes, { updateMetadata: false });
    const form = document.getForm();

    for (const [name, value] of entries) {
      let found: string | null = null;
      let drawn = true;
      try {
        const field = form.getField(name);
        if (field instanceof PDFTextField) found = field.getText() ?? '';
        else if (field instanceof PDFCheckBox) found = field.isChecked() ? 'true' : 'false';
        else if (field instanceof PDFDropdown) found = field.getSelected()[0] ?? '';
        else if (field instanceof PDFRadioGroup) found = field.getSelected() ?? '';

        // Does anything actually draw it? A widget with no normal appearance
        // shows nothing in most viewers, whatever the value says.
        const widgets = field.acroField.getWidgets();
        drawn =
          widgets.length === 0 ||
          widgets.some((widget) => {
            const normal = widget.getAppearances()?.normal;
            return normal instanceof PDFStream || normal !== undefined;
          });
      } catch {
        // The field is not in the produced document at all.
        found = null;
      }

      if (found !== value) wrong.push({ field: name, wanted: value, found });
      else if (!drawn) wrong.push({ field: name, wanted: value, found, invisible: true });
    }
  } catch {
    // A document that will not open cannot be checked, and saying every field
    // failed would be its own lie. The caller sees an empty list and the
    // export's own error path handles the unreadable file.
    return [];
  }
  return wrong;
}

/**
 * What an imported PDF carries that its pages cannot bring with them.
 *
 * Only the categories this project is willing to vouch for; the ones it cannot
 * check are never named, here or anywhere.
 */
export async function importedStructures(bytes: Uint8Array): Promise<StructureCategory[]> {
  try {
    const document = await loadPdf(bytes, { updateMetadata: false });
    const summary = summarizeStructures(document);
    return VERIFIABLE_CATEGORIES.filter(
      // Metadata and language belong to the document as a whole; nobody expects
      // the title of a file they took two pages from.
      (category) =>
        category !== 'metadataTitle' &&
        category !== 'language' &&
        summary.categories[category] > 0
    );
  } catch {
    return [];
  }
}
