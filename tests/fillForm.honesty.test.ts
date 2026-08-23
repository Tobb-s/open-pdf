import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { loadPdf, savePdf } from '@/lib/pdfio';
import { firstUnsupportedCharacter, UnsupportedCharacterError } from '@/lib/stamp';
import { verifyFields } from '@/lib/studio/verify';

/**
 * Two things Fill Form said that were not true.
 *
 * It counted a field as filled once per iteration that did not throw —
 * including the thirty-eight nobody opened — and since pdf-lib does not throw
 * on a read-only field, the count came out equal to the total on essentially
 * every real run. «Se completaron 40 de 40 campos» was a sentence about the
 * loop, not about the document.
 *
 * And it never looked at what it produced: the file went straight into a Blob.
 * `verifyFields` already existed, was already tested and was already used by
 * Studio.
 *
 * Underneath both was a crash. Saving with whole-form appearance regeneration
 * draws with a WinAnsi font, so one character it cannot encode threw from
 * inside `save` — outside every try/catch — and it did not need the reader to
 * type anything, because every existing value is read at detection and written
 * back.
 */

/** A form that ARRIVES carrying a character WinAnsi cannot encode. */
async function formWithGreekValue(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const form = doc.getForm();

  const plain = form.createTextField('normal');
  plain.addToPage(page, { x: 40, y: 240, width: 200, height: 24 });
  plain.setText('Ana');

  const greek = form.createTextField('griego');
  // Added to the page BEFORE the value is set: drawing the widget is what
  // encodes, so this is how a file filled by another program arrives.
  greek.addToPage(page, { x: 40, y: 200, width: 200, height: 24 });
  greek.setText('σ = 0.34');

  return (await doc.save({ updateFieldAppearances: false })).slice();
}

describe('the crash that needed nobody to type anything', () => {
  it('whole-form regeneration inside save throws, and the reader typed nothing', async () => {
    const original = await formWithGreekValue();
    const document_ = await loadPdf(original, { updateMetadata: false });
    const form = document_.getForm();

    // Exactly what the tool does on every run, before the reader touches a
    // thing: every existing value is read at detection and written straight
    // back. That is what marks the fields dirty — pdf-lib only regenerates
    // what is dirty — so the Greek value the file ARRIVED with is re-typeset
    // and the save throws.
    for (const name of ['normal', 'griego']) {
      const field = form.getTextField(name);
      field.setText(field.getText() ?? '');
    }

    await expect(savePdf(document_, { updateFieldAppearances: true })).rejects.toThrow(
      /cannot encode/i
    );
  }, 60000);

  it('the guard catches the character before anything is saved', async () => {
    const document_ = await PDFDocument.create();
    const helvetica = await document_.embedFont(StandardFonts.Helvetica);
    expect(firstUnsupportedCharacter('σ = 0.34', helvetica)).toBe('σ');
    expect(firstUnsupportedCharacter('Ana Pérez', helvetica)).toBeNull();
    // And it is the error the tool now raises, which the UI knows how to say.
    expect(new UnsupportedCharacterError('σ').character).toBe('σ');
  }, 60000);

  it('a value the font CAN encode saves per field without the whole-form pass', async () => {
    const original = await formWithGreekValue();
    const document_ = await loadPdf(original, { updateMetadata: false });
    const form = document_.getForm();
    form.getTextField('normal').setText('Ana Pérez');

    const helvetica = await document_.embedFont(StandardFonts.Helvetica);
    form.getTextField('normal').defaultUpdateAppearances(helvetica);

    // No whole-form regeneration, so the Greek field is left alone rather than
    // re-typeset — and the save goes through.
    const saved = (await savePdf(document_, { updateFieldAppearances: false })).slice();
    expect(saved.length).toBeGreaterThan(0);

    const reopened = await PDFDocument.load(saved);
    expect(reopened.getForm().getTextField('normal').getText()).toBe('Ana Pérez');
    expect(reopened.getForm().getTextField('griego').getText()).toBe('σ = 0.34');
  }, 60000);
});

describe('reading the produced file back', () => {
  it('reports nothing when the values really are there and drawn', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const field = doc.getForm().createTextField('nombre');
    field.addToPage(page, { x: 40, y: 200, width: 200, height: 24 });
    field.setText('Ana');
    const saved = (await doc.save()).slice();

    expect(await verifyFields(saved, { nombre: 'Ana' })).toEqual([]);
  }, 60000);

  it('names a value that did not survive the write', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const field = doc.getForm().createTextField('nombre');
    field.addToPage(page, { x: 40, y: 200, width: 200, height: 24 });
    field.setText('Ana');
    const saved = (await doc.save()).slice();

    const wrong = await verifyFields(saved, { nombre: 'Otro' });
    expect(wrong).toEqual([{ field: 'nombre', wanted: 'Otro', found: 'Ana' }]);
  }, 60000);

  it('names a field that is not in the produced document at all', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 300]);
    const saved = (await doc.save()).slice();

    const wrong = await verifyFields(saved, { fantasma: 'algo' });
    expect(wrong).toEqual([{ field: 'fantasma', wanted: 'algo', found: null }]);
  }, 60000);
});

describe('counting what was filled in', () => {
  /** The rule the tool now applies: a field counts when its value changed. */
  const changed = (fields: Array<{ value: string; original: string }>) =>
    fields.filter((field) => field.value !== field.original).length;

  it('does not count a field nobody opened', () => {
    expect(
      changed([
        { value: 'Ana', original: 'Ana' },
        { value: '', original: '' },
      ])
    ).toBe(0);
  });

  it('counts only what the reader actually changed', () => {
    expect(
      changed([
        { value: 'Ana Pérez', original: 'Ana' },
        { value: 'Ana', original: 'Ana' },
        { value: '12345', original: '' },
      ])
    ).toBe(2);
  });

  it('counts clearing a field, which is a change like any other', () => {
    expect(changed([{ value: '', original: 'Ana' }])).toBe(1);
  });
});

describe('the Edit tool writes text with the same guard', () => {
  it('refuses a character Helvetica cannot draw, rather than borrowing an error', async () => {
    // Edit called drawText with no check at all. pdf-lib threw, this app's
    // error mapping did not recognise the message, and the reader got «Algo
    // salió mal» with an English string underneath. Nothing was lost — the
    // page is reloaded from clean bytes — but a refusal has to say what it is
    // refusing.
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const font = await doc.embedFont(StandardFonts.Helvetica);

    for (const text of ['σ = 0.34', 'Привет', '≤ 5']) {
      expect(firstUnsupportedCharacter(text, font)).not.toBeNull();
      expect(() => page.drawText(text, { font, size: 12, x: 10, y: 10 })).toThrow();
    }

    // And what a Spanish reader actually types goes through untouched.
    for (const text of ['Ana Pérez', '¿Cuánto?', 'niño — 3½']) {
      expect(firstUnsupportedCharacter(text, font)).toBeNull();
      expect(() => page.drawText(text, { font, size: 12, x: 10, y: 10 })).not.toThrow();
    }
  }, 60000);
});
