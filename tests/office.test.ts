import { describe, expect, it } from 'vitest';
import { formatForFile, OFFICE_FORMATS, pdfNameFor } from '@/lib/office';

describe('formatForFile', () => {
  it('sends each family to the right LibreOffice filter', () => {
    expect(formatForFile('clase.pptx')?.filter).toBe('impress_pdf_Export');
    expect(formatForFile('tesis.docx')?.filter).toBe('writer_pdf_Export');
    expect(formatForFile('notas.xlsx')?.filter).toBe('calc_pdf_Export');
    expect(formatForFile('esquema.odg')?.filter).toBe('draw_pdf_Export');
  });

  it('accepts the open formats alongside the Microsoft ones', () => {
    expect(formatForFile('charla.odp')?.family).toBe('presentation');
    expect(formatForFile('informe.odt')?.family).toBe('document');
    expect(formatForFile('datos.ods')?.family).toBe('spreadsheet');
  });

  it('ignores the case of the extension', () => {
    // Uploads from Windows and from phones arrive with every casing there is.
    expect(formatForFile('CLASE 7.PPTX')?.filter).toBe('impress_pdf_Export');
    expect(formatForFile('Informe.Docx')?.family).toBe('document');
  });

  it('flags the legacy binary formats without refusing them', () => {
    expect(formatForFile('vieja.ppt')?.legacy).toBe(true);
    expect(formatForFile('vieja.doc')?.legacy).toBe(true);
    expect(formatForFile('nueva.pptx')?.legacy).toBeUndefined();
  });

  it('returns nothing for what LibreOffice is not being asked to open', () => {
    expect(formatForFile('foto.jpg')).toBeNull();
    expect(formatForFile('ya-es.pdf')).toBeNull();
    expect(formatForFile('sin-extension')).toBeNull();
  });

  it('matches on the end of the name, not anywhere in it', () => {
    expect(formatForFile('resumen.docx.zip')).toBeNull();
    expect(formatForFile('mi.pptx.backup.pptx')?.family).toBe('presentation');
  });

  it('gives every declared format a filter and a family', () => {
    for (const format of OFFICE_FORMATS) {
      expect(format.filter).toMatch(/_pdf_Export$/);
      expect(format.extension.startsWith('.')).toBe(true);
      expect(format.extension).toBe(format.extension.toLowerCase());
    }
  });
});

describe('pdfNameFor', () => {
  it('swaps the extension for .pdf', () => {
    expect(pdfNameFor('Clase 7.pptx')).toBe('Clase 7.pdf');
    expect(pdfNameFor('INFORME.DOCX')).toBe('INFORME.pdf');
  });

  it('only replaces the last extension', () => {
    expect(pdfNameFor('v1.2.final.pptx')).toBe('v1.2.final.pdf');
  });

  it('copes with a name that has no extension', () => {
    expect(pdfNameFor('presentacion')).toBe('presentacion.pdf');
  });
});
