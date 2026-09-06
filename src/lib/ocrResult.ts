import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { confidenceSummary, losesCharacters, toWinAnsi } from './ocr';
import { layerWords, type OcrPageResult } from './ocrAdvanced';
import { savePdf } from './pdfio';

/** A checkpoint contains completed pages only, in source order. No output PDF is accumulated. */
export function summarizeOcrPages(recognized: OcrPageResult[], pages: number) {
  if (!Number.isInteger(pages) || pages < 1 || recognized.length > pages ||
      recognized.some((page, index) => page.page !== index + 1)) {
    throw new Error('Invalid OCR checkpoint');
  }
  const words = recognized.flatMap(page => page.words);
  const confidence = confidenceSummary(words.map(word => word.confidence));
  return {
    recognized: recognized.slice(),
    pages,
    partial: recognized.length < pages,
    text: recognized.map(page => `--- Page ${page.page} ---\n${page.text}`).join('\n\n'),
    wordsFound: words.filter(word => toWinAnsi(word.text).length > 0).length,
    meanConfidence: confidence.mean,
    lowConfidence: confidence.low,
    stripped: words.filter(word => losesCharacters(word.text)).length,
  };
}

export type OcrResult = ReturnType<typeof summarizeOcrPages>;

/** Always start from the original: retries, partial exports and corrections cannot stack layers. */
export async function exportOcrPages(original: ArrayBuffer, recognized: OcrPageResult[]) {
  const output = await PDFDocument.load(original, { updateMetadata: false });
  summarizeOcrPages(recognized, output.getPageCount());
  const font = await output.embedFont(StandardFonts.Helvetica);
  for (const page of recognized) {
    for (const word of layerWords(page, (text, size) => font.widthOfTextAtSize(text, size))) {
      output.getPage(page.page - 1).drawText(word.text, {
        ...word, rotate: degrees(word.rotate), font, opacity: 0,
      });
    }
  }
  return (await savePdf(output)).slice();
}
