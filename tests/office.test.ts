import { describe, expect, it } from 'vitest';
import { OFFICE_EXTENSIONS, OFFICE_FORMATS, formatForFile, pdfNameFor } from '@/lib/office';
import { OFFICE_FILES } from '@/components/FileDropzone';
import { TOOLS } from '@/lib/tools';

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

  it('accepts the slideshow variants lecturers actually hand out', () => {
    // .ppsx is a .pptx that opens straight into the slideshow. Leaving it off
    // the list rejected three of the first four real files tried.
    expect(formatForFile('Clase.ppsx')?.filter).toBe('impress_pdf_Export');
    expect(formatForFile('Clase.pps')?.legacy).toBe(true);
    expect(formatForFile('Clase.ppsm')?.family).toBe('presentation');
  });

  it('accepts macro-enabled and template files', () => {
    // The macros never run: LibreOffice opens the document, not the code.
    expect(formatForFile('planilla.xlsm')?.filter).toBe('calc_pdf_Export');
    expect(formatForFile('informe.docm')?.filter).toBe('writer_pdf_Export');
    expect(formatForFile('plantilla.potx')?.family).toBe('presentation');
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

describe('the picker and the converter agree', () => {
  it('offers exactly the formats it can convert', () => {
    // Guards the gap that .ppsx fell through: a format that converts but cannot
    // be picked is invisible, and one that can be picked but has no filter
    // fails at the worst moment.
    expect([...OFFICE_FILES.extensions].sort()).toEqual([...OFFICE_EXTENSIONS].sort());
    expect(OFFICE_FILES.accept.split(',').sort()).toEqual([...OFFICE_EXTENSIONS].sort());
  });
});

describe('the converter route asks for a fresh document', () => {
  it('is flagged so links to it do not use a client-side transition', () => {
    // The bug this guards: cross-origin isolation is granted by headers on the
    // document response. Clicking a Next.js <Link> never fetches one, so the
    // page arrived without SharedArrayBuffer and told a perfectly capable
    // Chrome that it could not run the engine.
    const office = TOOLS.find((tool) => tool.slug === 'office-to-pdf');
    expect(office?.needsFreshDocument).toBe(true);
  });

  it('leaves the other tools on client-side navigation', () => {
    const others = TOOLS.filter((tool) => tool.slug !== 'office-to-pdf');
    expect(others.every((tool) => !tool.needsFreshDocument)).toBe(true);
    expect(others.length).toBeGreaterThan(0);
  });
});
