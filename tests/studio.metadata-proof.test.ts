import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { allTextIn, judgeRedaction } from '@/lib/studio/redaction';

describe('redaction proof over hidden metadata', () => {
  it('does not silently certify a subtree past its inspection limit', async () => {
    const document = await PDFDocument.create();
    let nested = document.context.obj({ Secret: PDFString.of('CONFIDENCIAL') });
    for (let depth = 0; depth < 30; depth++) nested = document.context.obj({ Child: nested });
    document.catalog.set(PDFName.of('PrivateData'), nested);
    expect(() => allTextIn(document)).toThrow(/verification refused/i);
  });
  it('finds a survivor in compressed XMP after saving and reopening', async () => {
    const document = await PDFDocument.create();
    document.addPage();
    const stream = document.context.flateStream('<xmp>CONFIDENCIAL</xmp>', {
      Type: 'Metadata', Subtype: 'XML',
    });
    document.catalog.set(PDFName.of('Metadata'), document.context.register(stream));
    const reopened = await PDFDocument.load(await document.save());
    expect(judgeRedaction([{ page: 'o0', words: ['CONFIDENCIAL'] }], allTextIn(reopened)).clean).toBe(false);
  });

  it('decodes escaped literal PDF strings before checking survivors', async () => {
    const document = await PDFDocument.create();
    document.catalog.set(PDFName.of('PrivateNote'), PDFString.of('CONFIDEN\\103IAL'));
    expect(allTextIn(document)).toContain('CONFIDENCIAL');
  });

  it('refuses to certify metadata whose filter cannot be decoded', async () => {
    const document = await PDFDocument.create();
    const stream = document.context.stream('opaque', { Type: 'Metadata', Filter: 'UnsupportedFilter' });
    document.catalog.set(PDFName.of('Metadata'), document.context.register(stream));
    expect(() => allTextIn(document)).toThrow(/metadata/i);
  });
});
