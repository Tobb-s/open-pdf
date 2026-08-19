import { describe, expect, it } from 'vitest';
import { derivedFileName, formatBytes, stripPdfExtension } from '@/lib/files';

describe('stripPdfExtension', () => {
  it('removes the extension whatever its case', () => {
    expect(stripPdfExtension('report.pdf')).toBe('report');
    // The bug this guards: `.replace('.pdf', '')` missed uppercase, so a Word
    // file came back named INFORME.PDF and Windows opened it in a PDF reader.
    expect(stripPdfExtension('INFORME.PDF')).toBe('INFORME');
    expect(stripPdfExtension('Notes.Pdf')).toBe('Notes');
  });

  it('only strips the extension, not a match in the middle', () => {
    expect(stripPdfExtension('my.pdf.notes.pdf')).toBe('my.pdf.notes');
    expect(stripPdfExtension('guide.pdf-v2.pdf')).toBe('guide.pdf-v2');
  });

  it('leaves a name without the extension alone', () => {
    expect(stripPdfExtension('scan')).toBe('scan');
    expect(stripPdfExtension('archive.pdfx')).toBe('archive.pdfx');
  });
});

describe('derivedFileName', () => {
  it('builds the download name from the source', () => {
    expect(derivedFileName('report.pdf', '_compressed.pdf')).toBe('report_compressed.pdf');
    expect(derivedFileName('INFORME.PDF', '.docx')).toBe('INFORME.docx');
  });
});

describe('formatBytes', () => {
  it('picks a readable unit', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(512)).toBe('512 bytes');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1_572_864)).toBe('1.5 MB');
  });

  it('does not fall apart on nonsense input', () => {
    expect(formatBytes(-1)).toBe('0 bytes');
    expect(formatBytes(Number.NaN)).toBe('0 bytes');
  });
});
