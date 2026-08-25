import { degrees } from 'pdf-lib';
import { loadPdf, savePdf } from '@/lib/pdfio';
import { stampPageNumbersOn, stampTextOn } from '@/lib/stamp';
import { summarizeStructures } from '@/lib/verify/structural';

export interface BatchRecipe {
  rotate: 0 | 90 | 180 | 270;
  watermark: string;
  pageNumbers: boolean;
  flattenForms: boolean;
}

export interface BatchDocumentResult {
  bytes: Uint8Array;
  pages: number;
  signedInput: boolean;
  flattenedFields: number;
}

export function hasBatchAction(recipe: BatchRecipe): boolean {
  return (
    recipe.rotate !== 0 ||
    recipe.watermark.trim() !== '' ||
    recipe.pageNumbers ||
    recipe.flattenForms
  );
}

/** Applies one fixed recipe without sharing state with any other input file. */
export async function applyBatchRecipe(
  source: Uint8Array,
  recipe: BatchRecipe,
  ofWord: string
): Promise<BatchDocumentResult> {
  if (!hasBatchAction(recipe)) throw new Error('The batch recipe has no actions.');

  const document = await loadPdf(source, { updateMetadata: false });
  const pages = document.getPages();
  const before = summarizeStructures(document);

  if (recipe.rotate !== 0) {
    for (const page of pages) {
      const current = page.getRotation().angle;
      page.setRotation(degrees(((current + recipe.rotate) % 360 + 360) % 360));
    }
  }

  const watermark = recipe.watermark.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (watermark !== '') {
    await stampTextOn(document, pages, {
      text: watermark,
      font: { family: 'helvetica', bold: true, italic: false },
      size: 42,
      color: { r: 0.35, g: 0.38, b: 0.44 },
      opacity: 0.18,
      angle: 45,
      anchor: 'center',
      margin: 36,
    });
  }

  if (recipe.pageNumbers) {
    await stampPageNumbersOn(document, pages, {
      font: { family: 'helvetica', bold: false, italic: false },
      size: 10,
      color: { r: 0.2, g: 0.22, b: 0.27 },
      anchor: 'bottom-center',
      margin: 24,
      startAt: 1,
      format: 'ofTotal',
      ofWord,
    });
  }

  let flattenedFields = 0;
  if (recipe.flattenForms) {
    const form = document.getForm();
    const fieldCount = form.getFields().length;
    if (fieldCount > 0) form.flatten({ updateFieldAppearances: false });
    flattenedFields = fieldCount;
  }

  return {
    bytes: (await savePdf(document)).slice(),
    pages: pages.length,
    signedInput: before.categories.signatures > 0,
    flattenedFields,
  };
}

export function batchOutputName(name: string, index: number): string {
  const base = name.replace(/\.pdf$/i, '') || 'document';
  return `${String(index + 1).padStart(3, '0')}-${base}_batch.pdf`;
}
