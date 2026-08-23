import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { allTextIn, judgeRedaction } from '@/lib/studio/redaction';

/**
 * What the redaction check can see.
 *
 * It used to read two things: the text a viewer draws on each page, and the
 * values of the form fields. A name can outlive a redaction in neither of those
 * and still be a `Ctrl+F` away — in the title, in the XMP block, in a bookmark,
 * in a comment on a page nobody painted, in the filename of an attachment.
 * `materialize` edits the original document in place rather than rebuilding it
 * from copied pages, which is what keeps the form and the bookmarks alive, and
 * which is exactly why all of those survive a redaction by default.
 *
 * So each hiding place gets a test. A check that is only as good as the list of
 * places someone thought of needs the list written down where it can fail.
 */

const NAME = 'MarianaBelforte';

describe('allTextIn', () => {
  it('finds a name in the title', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.setTitle(`Contrato - ${NAME}`);
    const out = await PDFDocument.load(await doc.save());
    expect(allTextIn(out)).toContain(NAME);
  });

  it('finds a name in the author, the subject and the keywords', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.setAuthor(NAME);
    doc.setSubject(`Sobre ${NAME}`);
    doc.setKeywords([NAME, 'expediente']);
    const out = await PDFDocument.load(await doc.save());
    const all = allTextIn(out);
    // Three separate entries, so a single one being read is not enough.
    expect(all.match(new RegExp(NAME, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('finds a name in an XMP metadata packet, which pdf-lib has no API for', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const xmp = `<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/">
      <dc:title><rdf:Alt><rdf:li>${NAME}</rdf:li></rdf:Alt></dc:title>
      </x:xmpmeta><?xpacket end="w"?>`;
    const stream = doc.context.stream(xmp, {
      Type: PDFName.of('Metadata'),
      Subtype: PDFName.of('XML'),
    });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));

    const out = await PDFDocument.load(await doc.save());
    expect(allTextIn(out)).toContain(NAME);
  });

  it('finds a name in a bookmark title', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const context = doc.context;
    const dest = context.obj([page.ref, PDFName.of('XYZ'), null, null, null]);
    const item = context.obj({ Title: PDFString.of(`Caso ${NAME}`), Dest: dest });
    const itemRef = context.register(item);
    const outlines = context.obj({
      Type: PDFName.of('Outlines'),
      First: itemRef,
      Last: itemRef,
      Count: 1,
    });
    const outlinesRef = context.register(outlines);
    item.set(PDFName.of('Parent'), outlinesRef);
    doc.catalog.set(PDFName.of('Outlines'), outlinesRef);

    const out = await PDFDocument.load(await doc.save());
    expect(allTextIn(out)).toContain(NAME);
  });

  it('finds a name in an annotation on a page nobody painted', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const note = doc.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Text'),
      Rect: doc.context.obj([10, 10, 30, 30]),
      Contents: PDFString.of(`Hablar con ${NAME}`),
    });
    page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(note)]));

    const out = await PDFDocument.load(await doc.save());
    expect(allTextIn(out)).toContain(NAME);
  });

  it('finds a name in the filename of an attachment', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    await doc.attach(new Uint8Array([1, 2, 3]), `${NAME}.txt`, {
      mimeType: 'text/plain',
    });

    const out = await PDFDocument.load(await doc.save());
    expect(allTextIn(out)).toContain(NAME);
  });

  it('DECODES a hex string rather than matching it raw', async () => {
    // pdf-lib writes anything non-ASCII as UTF-16BE hex. Searching the raw form
    // finds nothing and proves nothing — the mistake that made an earlier
    // version of this check report a file clean while the value sat in it.
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.catalog.set(PDFName.of('OpenPDFProbe'), PDFHexString.fromText('Tobías Ñandú'));

    const out = await PDFDocument.load(await doc.save());
    const all = allTextIn(out);
    expect(all).toContain('Tobías Ñandú');
    expect(all).not.toContain('00540062');
  });

  it('does not choke on a document that points at itself', async () => {
    // A cycle in the object graph must not hang the export. Every indirect
    // object is visited on its own, so references are never followed.
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const ring = doc.context.obj({ Note: PDFString.of(NAME) });
    const ref = doc.context.register(ring);
    ring.set(PDFName.of('Self'), ref);
    doc.catalog.set(PDFName.of('OpenPDFRing'), ref);

    const out = await PDFDocument.load(await doc.save());
    expect(allTextIn(out)).toContain(NAME);
  });
});

describe('judgeRedaction counts what it actually looked for', () => {
  it('reports zero checked when there was no text under the paint', () => {
    // A scanned page. The redaction happened — the page became a picture — but
    // nothing was verified, and `clean` alone cannot say the difference.
    const verdict = judgeRedaction([{ page: 'o0', words: [] }], 'lo que sea');
    expect(verdict.clean).toBe(true);
    expect(verdict.checked).toBe(0);
  });

  it('does not count words too short to be evidence', () => {
    const verdict = judgeRedaction([{ page: 'o0', words: ['de', 'el', 'Belforte'] }], '');
    expect(verdict.checked).toBe(1);
  });

  it('counts what it found as well as what it looked for', () => {
    const verdict = judgeRedaction(
      [{ page: 'o0', words: ['Belforte', 'Mariana'] }],
      'algo Belforte algo'
    );
    expect(verdict.checked).toBe(2);
    expect(verdict.survivors).toEqual(['Belforte']);
    expect(verdict.clean).toBe(false);
  });
});
