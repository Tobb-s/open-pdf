import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { materialize } from '@/lib/studio/materialize';
import { stateAt } from '@/lib/studio/script';
import {
  diffStructures,
  reportStructures,
  summarizeStructures,
  VERIFIABLE_CATEGORIES,
} from '@/lib/verify/structural';

/**
 * The one claim this app cannot make.
 *
 * A digital signature covers the exact bytes of the file it was made over, and
 * every tool here writes a NEW file rather than appending an incremental
 * update. So the digest stops describing the bytes and the signature is dead —
 * however intact the dictionary that holds it still looks.
 *
 * The verifier used to count a signature field as a form field, so a signed
 * contract came out of a rebuild with the same count it went in with, nothing
 * was reported lost, and the result card said the form had survived. Not an
 * unproven claim: a claim about something the rebuild had just destroyed.
 */

interface SignedOptions {
  /** A signature with no value: somewhere to sign, not a signature. */
  empty?: boolean;
  /** Also give the document an ordinary fillable field. */
  withTextField?: boolean;
}

async function signedDocument(options: SignedOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  doc.addPage([400, 300]);
  const context = doc.context;

  const widget = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'),
    T: PDFString.of('Firma1'),
    Rect: context.obj([40, 40, 240, 90]),
    F: PDFNumber.of(4),
    P: page.ref,
  });

  if (!options.empty) {
    const signature = context.obj({
      Type: PDFName.of('Sig'),
      Filter: PDFName.of('Adobe.PPKLite'),
      SubFilter: PDFName.of('adbe.pkcs7.detached'),
      ByteRange: context.obj([
        PDFNumber.of(0),
        PDFNumber.of(840),
        PDFNumber.of(960),
        PDFNumber.of(120),
      ]),
      Contents: PDFHexString.of('308006092A864886F70D010702A0803080'),
      Name: PDFString.of('Mariana Belforte'),
    });
    widget.set(PDFName.of('V'), context.register(signature));
  }

  const widgetRef = context.register(widget);
  page.node.set(PDFName.of('Annots'), context.obj([widgetRef]));

  const fields = [widgetRef];
  if (options.withTextField) {
    const field = doc.getForm().createTextField('observaciones');
    field.setText('nada');
    field.addToPage(page, { x: 40, y: 200, width: 200, height: 24 });
  }

  const existing = doc.catalog.get(PDFName.of('AcroForm'));
  if (existing === undefined) {
    doc.catalog.set(
      PDFName.of('AcroForm'),
      context.register(
        context.obj({ Fields: context.obj(fields), SigFlags: PDFNumber.of(3) })
      )
    );
  } else {
    // `createTextField` already made the form; add the signature to it.
    const form = doc.getForm();
    form.acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3));
    form.acroForm.normalizedEntries().Fields.push(widgetRef);
  }

  return (await doc.save()).slice();
}

describe('counting a signature', () => {
  it('counts it as a signature, not as a form field', async () => {
    const summary = summarizeStructures(await PDFDocument.load(await signedDocument()));
    expect(summary.categories.signatures).toBe(1);
    // The heart of it. A dead signature is not a surviving form.
    expect(summary.categories.form).toBe(0);
  });

  it('separates a real field from the signature beside it', async () => {
    const summary = summarizeStructures(
      await PDFDocument.load(await signedDocument({ withTextField: true }))
    );
    expect(summary.categories.signatures).toBe(1);
    expect(summary.categories.form).toBe(1);
  });

  it('does not call an empty signature field a signature', async () => {
    // A placeholder — somewhere for a signature to go. Nothing breaks by
    // rebuilding a document that has one, so warning about it would be noise,
    // and this app's warnings only work while they are all true.
    const summary = summarizeStructures(
      await PDFDocument.load(await signedDocument({ empty: true }))
    );
    expect(summary.categories.signatures).toBe(0);
  });

  it('is never something whose survival can be claimed', () => {
    expect(VERIFIABLE_CATEGORIES).not.toContain('signatures');
  });
});

describe('what the result card would say about a signed document', () => {
  it('no longer claims the form survived', async () => {
    const original = await signedDocument();
    const before = summarizeStructures(await PDFDocument.load(original));

    // The lightest edit there is: turn the OTHER page.
    const { bytes } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(2, [{ kind: 'rotate', page: 'o1', turns: 1 }], 1),
    });
    const after = summarizeStructures(await PDFDocument.load(bytes));

    // This is the list the card renders as «se conservaron …».
    const claimed = VERIFIABLE_CATEGORIES.filter((category) => before.categories[category] > 0);
    expect(claimed).not.toContain('form');
    expect(claimed).not.toContain('signatures');

    // And nothing is reported as a loss either, because a count that goes 0→0
    // is not what makes a signature dead — the rewritten bytes are, and that is
    // said in words rather than in a number.
    expect(diffStructures(before, after)).toEqual([]);
  }, 60000);

  it('the file really is rewritten, which is what kills the signature', async () => {
    const original = await signedDocument();
    const { bytes } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(2, [{ kind: 'rotate', page: 'o1', turns: 1 }], 1),
    });

    // Not an incremental update: a signature's /ByteRange describes offsets in
    // the original file, and this is not that file with something appended.
    const prefix = Buffer.from(bytes.slice(0, Math.min(original.length, bytes.length)));
    expect(Buffer.compare(prefix, Buffer.from(original.slice(0, prefix.length)))).not.toBe(0);
  }, 60000);

  it('still says the document was signed after the rebuild', async () => {
    // The dictionary survives the rebuild — it is reachable from the form — so
    // the count stays at one. That is exactly why the warning is worded as a
    // fact about the operation rather than as a loss: nothing went missing, and
    // the signature is dead all the same.
    const original = await signedDocument();
    const { bytes } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(2, [{ kind: 'rotate', page: 'o1', turns: 1 }], 1),
    });
    const after = summarizeStructures(await PDFDocument.load(bytes));
    expect(after.categories.signatures).toBe(1);
  }, 60000);
});

describe('the report the tools render', () => {
  it('says the signature broke when the bytes really were rewritten', async () => {
    const original = await signedDocument();
    const { bytes } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(2, [{ kind: 'rotate', page: 'o1', turns: 1 }], 1),
    });

    const report = await reportStructures(original, bytes);
    expect(report.signatureBroken).toBe(true);
    // Not in either list, and that is the design: nothing went missing.
    expect(report.present).not.toContain('signatures');
    expect(report.losses.map((loss) => loss.category)).not.toContain('signatures');
  }, 60000);

  it('stays false for a document that was never signed', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 300]);
    const original = (await doc.save()).slice();
    const { bytes } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(1, [{ kind: 'rotate', page: 'o0', turns: 1 }], 1),
    });

    const report = await reportStructures(original, bytes);
    expect(report.signatureBroken).toBe(false);
  }, 60000);

  it('stays false for an unsigned placeholder field', async () => {
    // Warning about a blank signature field would be noise, and this app's
    // warnings only keep working while every one of them is true.
    const original = await signedDocument({ empty: true });
    const { bytes } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(2, [{ kind: 'rotate', page: 'o1', turns: 1 }], 1),
    });

    expect((await reportStructures(original, bytes)).signatureBroken).toBe(false);
  }, 60000);
});

describe('the lie in the other direction', () => {
  it('does NOT say the signature broke when nothing was changed', async () => {
    // Studio hands back the original file byte for byte when the edit list is
    // empty, so the signature on it is still perfectly valid. Announcing that
    // it had been broken would be the same failure this whole change exists to
    // fix, pointed the other way — and it is the one an ordinary reader would
    // hit first, by opening a signed contract to look at it and exporting.
    const original = await signedDocument();
    const { bytes } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(2, [], 0),
    });

    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(original))).toBe(0);
    expect((await reportStructures(original, bytes)).signatureBroken).toBe(false);
  }, 60000);

  it('says it broke as soon as one page is turned', async () => {
    const original = await signedDocument();
    const { bytes } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(2, [{ kind: 'rotate', page: 'o1', turns: 1 }], 1),
    });

    expect((await reportStructures(original, bytes)).signatureBroken).toBe(true);
  }, 60000);
});

/**
 * Two shapes the adversarial review found, both of which the first version of
 * this change got wrong — and one of which it got wrong in the direction this
 * whole file exists to prevent.
 */
describe('shapes the first attempt got wrong', () => {
  /**
   * The hierarchy pdf-lib builds for a dotted name: one parent with the fields
   * as kids. `form.createTextField('formulario.nombre')` produces exactly this,
   * and this repo's own fixture uses it.
   */
  async function hierarchicalSignedForm(
    options: { pages?: number } = {}
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    for (let extra = 1; extra < (options.pages ?? 1); extra += 1) doc.addPage([400, 300]);
    const context = doc.context;

    const kidRefs = [];
    for (const [name, y] of [
      ['nombre', 240],
      ['dni', 200],
      ['domicilio', 160],
    ] as const) {
      const kid = context.obj({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Widget'),
        FT: PDFName.of('Tx'),
        T: PDFString.of(name),
        V: PDFString.of('algo'),
        Rect: context.obj([40, y, 300, y + 24]),
        P: page.ref,
      });
      kidRefs.push(context.register(kid));
    }

    const signatureValue = context.obj({
      Type: PDFName.of('Sig'),
      ByteRange: context.obj([PDFNumber.of(0), PDFNumber.of(840)]),
      Contents: PDFHexString.of('3080'),
    });
    const signatureKid = context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Widget'),
      FT: PDFName.of('Sig'),
      T: PDFString.of('firma'),
      V: context.register(signatureValue),
      Rect: context.obj([40, 40, 300, 100]),
      P: page.ref,
    });
    kidRefs.push(context.register(signatureKid));

    const parent = context.obj({ T: PDFString.of('formulario'), Kids: context.obj(kidRefs) });
    const parentRef = context.register(parent);
    for (const ref of kidRefs) {
      const kid = context.lookup(ref);
      if (kid && 'set' in kid) (kid as { set: (k: unknown, v: unknown) => void }).set(PDFName.of('Parent'), parentRef);
    }

    page.node.set(PDFName.of('Annots'), context.obj(kidRefs));
    doc.catalog.set(
      PDFName.of('AcroForm'),
      context.register(context.obj({ Fields: context.obj([parentRef]), SigFlags: PDFNumber.of(3) }))
    );

    return (await doc.save()).slice();
  }

  it('THE INVERSION: a signature under a parent must not hide its filled fields', async () => {
    // The first attempt skipped the whole top-level entry whenever anything
    // under it was signed, so these three filled fields counted as no form at
    // all. Destroying them was then reported as no loss — and the card said the
    // form had been kept. Exactly the claim this change exists to stop.
    const summary = summarizeStructures(await PDFDocument.load(await hierarchicalSignedForm()));
    expect(summary.categories.form).toBe(1);
    expect(summary.categories.signatures).toBe(1);
  });

  it('and the loss IS reported when those fields really do go', async () => {
    // The half that makes the fix a fix. Deleting the page the widgets are on
    // destroys three filled fields, and that has to reach the reader — under
    // the first attempt it came back as no loss at all, beside a line saying
    // the form had been kept.
    const original = await hierarchicalSignedForm({ pages: 2 });
    const { bytes } = await materialize({
      original,
      assets: new Map(),
      // Every widget was on the first page.
      state: stateAt(2, [{ kind: 'delete', page: 'o0' }], 1),
    });

    const before = summarizeStructures(await PDFDocument.load(original));
    const after = summarizeStructures(await PDFDocument.load(bytes));

    expect(before.categories.form).toBe(1);
    expect(after.categories.form).toBe(0);
    expect(diffStructures(before, after).map((loss) => loss.category)).toContain('form');
  }, 60000);

  it('a usage-rights signature in /Perms is seen, though it is in no form', async () => {
    // The Reader-extended shape. It signs the whole byte range and has no entry
    // in /Fields by construction, so a form-only search never saw it and the
    // reader lost the extended rights their file was distributed for in
    // silence.
    const doc = await PDFDocument.create();
    doc.addPage([400, 300]);
    const context = doc.context;
    const signature = context.obj({
      Type: PDFName.of('Sig'),
      ByteRange: context.obj([PDFNumber.of(0), PDFNumber.of(840)]),
      Contents: PDFHexString.of('3080'),
      Reference: context.obj([
        context.obj({ Type: PDFName.of('SigRef'), TransformMethod: PDFName.of('UR3') }),
      ]),
    });
    doc.catalog.set(
      PDFName.of('Perms'),
      context.register(context.obj({ UR3: context.register(signature) }))
    );

    const summary = summarizeStructures(await PDFDocument.load(await doc.save()));
    expect(summary.categories.signatures).toBe(1);
    // And with no AcroForm anywhere, which is the case that used to be skipped.
    expect(summary.categories.form).toBe(0);
  });

  it('does not count a certification signature twice', async () => {
    // A /DocMDP signature is named in /Perms AND in the form.
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const context = doc.context;
    const signature = context.obj({
      Type: PDFName.of('Sig'),
      ByteRange: context.obj([PDFNumber.of(0), PDFNumber.of(840)]),
      Contents: PDFHexString.of('3080'),
    });
    const signatureRef = context.register(signature);
    const widget = context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Widget'),
      FT: PDFName.of('Sig'),
      T: PDFString.of('cert'),
      V: signatureRef,
      Rect: context.obj([40, 40, 240, 90]),
      P: page.ref,
    });
    const widgetRef = context.register(widget);
    page.node.set(PDFName.of('Annots'), context.obj([widgetRef]));
    doc.catalog.set(
      PDFName.of('AcroForm'),
      context.register(context.obj({ Fields: context.obj([widgetRef]), SigFlags: PDFNumber.of(3) }))
    );
    doc.catalog.set(PDFName.of('Perms'), context.register(context.obj({ DocMDP: widgetRef })));

    const summary = summarizeStructures(await PDFDocument.load(await doc.save()));
    expect(summary.categories.signatures).toBe(1);
  });
});
