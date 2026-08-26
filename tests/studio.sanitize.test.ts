import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { sanitizeDocument } from '@/lib/studio/sanitize';
import { summarizeStructures } from '@/lib/verify/structural';

describe('Studio document sanitization', () => {
  it('removes metadata, comments, attachments and active actions while keeping links', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([300, 200]);
    document.setTitle('Secreto');
    document.setAuthor('Persona');
    document.context.lookup(document.context.trailerInfo.Info, PDFDict).set(
      PDFName.of('InternalCaseId'),
      PDFString.of('ABC-123')
    );
    await document.attach(Uint8Array.of(1, 2, 3), 'private.txt');

    const comment = document.context.register(
      document.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [20, 20, 40, 40],
        Contents: PDFString.of('oculto'),
      })
    );
    const link = document.context.register(
      document.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [50, 20, 100, 40],
        A: { S: 'URI', URI: PDFString.of('https://example.com') },
      })
    );
    page.node.set(PDFName.of('Annots'), document.context.obj([comment, link]));
    document.catalog.set(
      PDFName.of('OpenAction'),
      document.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') })
    );
    const structure = document.context.register(
      document.context.obj({ Type: 'StructElem', A: { O: 'Layout' } })
    );

    // Attachments are queued by pdf-lib and only enter /Names on save. Reopen
    // once so this exercises the shape of a real file Studio receives.
    const opened = await PDFDocument.load(await document.save(), { updateMetadata: false });

    sanitizeDocument(opened, {
      metadata: true,
      comments: true,
      attachments: true,
      actions: true,
    });

    const bytes = await opened.save({ updateFieldAppearances: false });
    const output = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(output.getTitle()).toBeUndefined();
    expect(output.getAuthor()).toBeUndefined();
    const info = output.context.lookup(output.context.trailerInfo.Info, PDFDict);
    expect(info.get(PDFName.of('InternalCaseId'))).toBeUndefined();
    expect(summarizeStructures(output).categories.attachments).toBe(0);
    expect(output.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();

    const annotations = output.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    expect(annotations.size()).toBe(1);
    const remaining = output.context.lookup(annotations.get(0), PDFDict);
    expect(remaining.get(PDFName.of('Subtype'))).toEqual(PDFName.of('Link'));
    expect(remaining.get(PDFName.of('A'))).toBeUndefined();
    expect(output.context.lookup(structure, PDFDict).get(PDFName.of('A'))).toBeDefined();
  });
});
