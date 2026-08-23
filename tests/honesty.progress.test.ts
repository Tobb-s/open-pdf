import { describe, expect, it } from 'vitest';
import { confidenceSummary, LOW_CONFIDENCE, losesCharacters } from '@/lib/ocr';
import { downloadProgress, sizesFromManifest } from '@/lib/office';

/**
 * Three honesty gaps, fixed together because they are the same gap.
 *
 * OCR received a confidence per word from tesseract and threw it away, then
 * reported the word count as though every word were certain; and it stripped
 * characters the PDF font cannot carry without saying so. The Office tool
 * divided its download progress by a `content-length` a browser never gets —
 * it asks compressed, the CDN answers chunked — so the bar sat at 0% for a
 * quarter of a gigabyte. PDF to Word said «listo» the moment any page had
 * text, whatever the other pages held.
 *
 * The decisions live in lib/ so they can be tested without a page.
 */

describe('what OCR now says about what it read', () => {
  it('keeps the mean and counts the doubtful, instead of a bare total', () => {
    expect(confidenceSummary([95, 90, 40, 85])).toEqual({ mean: 78, low: 1 });
  });

  it('draws the line where the engine itself stops being sure', () => {
    expect(confidenceSummary([LOW_CONFIDENCE]).low).toBe(0);
    expect(confidenceSummary([LOW_CONFIDENCE - 1]).low).toBe(1);
  });

  it('has nothing to say about nothing', () => {
    expect(confidenceSummary([])).toEqual({ mean: 0, low: 0 });
  });

  it('knows when the search layer will carry a word with something missing', () => {
    // A ligature, an arrow and another alphabet all fall outside WinAnsi.
    expect(losesCharacters('ﬁnal')).toBe(true);
    expect(losesCharacters('precio→10')).toBe(true);
    expect(losesCharacters('Привет')).toBe(true);
    // Spanish goes through whole.
    expect(losesCharacters('Añejo, señor — ¿cuánto? 3½')).toBe(false);
  });
});

describe('what the Office download says about itself', () => {
  it('reads the sizes the build recorded, by name, for the engine files only', () => {
    const manifest = {
      files: [
        { file: 'lowa/soffice.wasm', bytes: 161667499 },
        { file: 'lowa/soffice.data', bytes: 99543210 },
        { file: 'pdfjs/pdf.worker.min.mjs', bytes: 1312452 },
        { file: 'lowa/soffice.js', bytes: 812000 },
      ],
    };
    const sizes = sizesFromManifest(manifest, ['soffice.wasm', 'soffice.data']);
    expect([...sizes.entries()]).toEqual([
      ['soffice.wasm', 161667499],
      ['soffice.data', 99543210],
    ]);
  });

  it('turns a manifest it cannot trust into no sizes, never into a guess', () => {
    expect(sizesFromManifest(null, ['soffice.wasm']).size).toBe(0);
    expect(sizesFromManifest({ files: 'nope' }, ['soffice.wasm']).size).toBe(0);
    expect(sizesFromManifest({ files: [{ file: 'lowa/soffice.wasm', bytes: 0 }] }, ['soffice.wasm']).size).toBe(0);
    expect(sizesFromManifest({ files: [{ file: 'lowa/soffice.wasm' }] }, ['soffice.wasm']).size).toBe(0);
  });

  it('gives a fraction only when EVERY size is known', () => {
    expect(downloadProgress([50, 25], [100, 100])).toEqual({
      fraction: 0.375,
      loadedBytes: 75,
      totalBytes: 200,
    });
  });

  it('reports the bytes on their own when one size is missing', () => {
    // THE DEFECT, by its shape: a partial total would run the bar past the end
    // and park it at 100% while bytes still arrive — the same lie as 0%, told
    // the other way. With nothing to divide by, the honest number is the
    // count so far, and the interface shows that instead of a percentage.
    expect(downloadProgress([50, 25], [100, null])).toEqual({
      fraction: null,
      loadedBytes: 75,
      totalBytes: null,
    });
    expect(downloadProgress([50], [0])).toEqual({ fraction: null, loadedBytes: 50, totalBytes: null });
  });

  it('never claims more than the whole', () => {
    // Sizes come from the manifest; if a file on disk were a byte longer than
    // recorded, the bar must stop at 100%, not overshoot.
    expect(downloadProgress([101], [100]).fraction).toBe(1);
  });
});
