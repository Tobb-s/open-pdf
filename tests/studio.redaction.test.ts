import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';
import { materialize } from '@/lib/studio/materialize';
import { stateAt, type Edit } from '@/lib/studio/script';
import {
  insideAny,
  judgeRedaction,
  redactedPages,
  worthChecking,
} from '@/lib/studio/redaction';

/**
 * Stage five: taking information out, and proving it went.
 *
 * The proof is the point. Everything else in this project reports what it did;
 * this is the one thing that refuses to hand over a file when it cannot show
 * the data is gone.
 */

/** A page whose secret sits at a known place, so a test can aim at it. */
async function documentWithSecret(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText('PUBLICO', { x: 40, y: 240, size: 18, font, color: rgb(0, 0, 0) });
  page.drawText('CONFIDENCIAL', { x: 40, y: 120, size: 18, font, color: rgb(0, 0, 0) });
  doc.addPage([400, 300]).drawText('OTRA PAGINA', { x: 40, y: 240, size: 18, font });
  return (await doc.save()).slice();
}

/**
 * A tiny solid-white PNG of a given pixel size.
 *
 * It stands in for the bitmap the editor makes with a canvas, which Node has
 * none of. What matters for these tests is that the page is REPLACED, not that
 * the pixels are photographic — and the pixel size is the handle a test uses to
 * tell one embedded image from another in the produced file.
 */
async function makePng(w: number, h: number): Promise<Uint8Array> {
  const { deflateSync } = await import('node:zlib');
  const raw = Buffer.alloc((w * 3 + 1) * h, 0xff);
  for (let y = 0; y < h; y += 1) raw[y * (w * 3 + 1)] = 0;

  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = (buffer: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, check]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 6 })),
      chunk('IEND', Buffer.alloc(0)),
    ])
  );
}

let secret: Uint8Array;
let png: Uint8Array;

beforeAll(async () => {
  secret = await documentWithSecret();
  png = await makePng(8, 6);
});

describe('worthChecking', () => {
  it('ignores tokens too short to mean anything', () => {
    // Looking for "de" would block every export over a coincidence and teach
    // the reader to ignore the warning.
    expect(worthChecking('de')).toBe(false);
    expect(worthChecking('a')).toBe(false);
    expect(worthChecking('...')).toBe(false);
    expect(worthChecking('  ')).toBe(false);
  });

  it('checks anything that could identify someone', () => {
    expect(worthChecking('Baziti')).toBe(true);
    expect(worthChecking('20-12345678-9')).toBe(true);
    expect(worthChecking('CONFIDENCIAL')).toBe(true);
  });
});

describe('insideAny', () => {
  const boxes = [{ x: 30, y: 100, width: 200, height: 40 }];

  it('catches a word that overlaps the painted region at all', () => {
    expect(insideAny({ x: 40, y: 110, width: 60, height: 12 }, boxes)).toBe(true);
    // Only its tail overlaps, which is still enough to be readable.
    expect(insideAny({ x: 220, y: 110, width: 60, height: 12 }, boxes)).toBe(true);
  });

  it('leaves a word that is clear of it alone', () => {
    expect(insideAny({ x: 40, y: 220, width: 60, height: 12 }, boxes)).toBe(false);
    expect(insideAny({ x: 300, y: 110, width: 60, height: 12 }, boxes)).toBe(false);
  });
});

describe('judgeRedaction', () => {
  const targets = [{ page: 'o0', words: ['CONFIDENCIAL', 'Baziti'] }];

  it('passes when the words are nowhere in the produced text', () => {
    expect(judgeRedaction(targets, 'PUBLICO OTRA PAGINA')).toEqual({
      clean: true,
      survivors: [],
      // Two words were looked for and neither was found. That is different from
      // having had nothing to look for, which is what `checked: 0` means.
      checked: 2,
    });
  });

  it('fails, and names what survived', () => {
    const verdict = judgeRedaction(targets, 'PUBLICO CONFIDENCIAL OTRA');
    expect(verdict.clean).toBe(false);
    expect(verdict.survivors).toEqual(['CONFIDENCIAL']);
  });

  it('is not fooled by different case or spacing', () => {
    // A viewer that splits the words differently is still showing them.
    expect(judgeRedaction(targets, 'algo  confidencial  aqui').clean).toBe(false);
  });

  it('says nothing about words too short to be evidence', () => {
    expect(judgeRedaction([{ page: 'o0', words: ['de', 'el'] }], 'de el').clean).toBe(true);
  });
});

describe('a redacted page in the produced document', () => {
  const rasterEdit = (page: string, boxes: Array<{ x: number; y: number; width: number; height: number }>): Edit => ({
    kind: 'raster',
    page,
    raster: { asset: 'bitmap', boxes },
  });

  it('THE STAGE GATE: the text under the paint is not in the file', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { bytes } = await materialize({
      original: secret,
      assets: new Map([['bitmap', png]]),
      state: stateAt(2, [rasterEdit('o0', [{ x: 30, y: 110, width: 220, height: 40 }])], 1),
    });

    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const document = await task.promise;
    let all = '';
    for (let number = 1; number <= document.numPages; number += 1) {
      const content = await (await document.getPage(number)).getTextContent();
      all += content.items.map((item) => ('str' in item ? item.str : '')).join(' ') + ' ';
    }
    await task.destroy();

    // The whole page became a picture, so nothing it said survives as text —
    // not the secret, and not the rest of that page either. That cost is the
    // honest one, and the interface says so.
    expect(all).not.toContain('CONFIDENCIAL');
    expect(all).not.toContain('PUBLICO');
    // The page that was not touched keeps its text.
    expect(all).toContain('OTRA PAGINA');
  });

  it('the words are not in the BYTES either, not merely undrawn', async () => {
    // The plan asked for a byte-level test, and this is it. pdf.js not finding
    // the text only says nothing draws it; what matters is that the characters
    // are not sitting in a stream for someone to pull out. Every stream in the
    // produced file is decompressed and searched — for the text as written and
    // for the hex form pdf-lib actually emits.
    const { PDFRawStream, PDFStream } = await import('pdf-lib');
    const { inflateSync } = await import('node:zlib');

    const { bytes } = await materialize({
      original: secret,
      assets: new Map([['bitmap', png]]),
      state: stateAt(2, [rasterEdit('o0', [{ x: 30, y: 110, width: 220, height: 40 }])], 1),
    });
    const out = await PDFDocument.load(bytes);

    const needle = 'CONFIDENCIAL';
    const hex = Buffer.from(needle, 'latin1').toString('hex').toUpperCase();

    let found = false;
    for (const [, object] of out.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFStream)) continue;
      let body: string;
      try {
        const contents =
          object instanceof PDFRawStream ? object.contents : object.getContents();
        const buffer = Buffer.from(contents);
        body = object.dict.get(PDFName.of('Filter'))
          ? inflateSync(buffer).toString('latin1')
          : buffer.toString('latin1');
      } catch {
        continue;
      }
      if (body.includes(needle) || body.toUpperCase().includes(hex)) found = true;
    }
    expect(found).toBe(false);

    // And the same search over the raw file, in case a stream escaped the walk.
    const whole = Buffer.from(bytes).toString('latin1');
    expect(whole.includes(needle)).toBe(false);
  });

  it('comes out square: no rotation and no crop left to undo the picture', async () => {
    const rotated = await PDFDocument.create();
    const page = rotated.addPage([400, 300]);
    page.setRotation((await import('pdf-lib')).degrees(90));
    const original = (await rotated.save()).slice();

    const { bytes } = await materialize({
      original,
      assets: new Map([['bitmap', png]]),
      state: stateAt(1, [rasterEdit('o0', [])], 1),
    });
    const out = await PDFDocument.load(bytes);
    const made = out.getPage(0);

    expect(made.getRotation().angle).toBe(0);
    // The page kept the size it LOOKED: a 400x300 page turned 90 looks 300x400.
    expect(Math.round(made.getWidth())).toBe(300);
    expect(Math.round(made.getHeight())).toBe(400);
  });

  it('leaves the other pages exactly as they were', async () => {
    const { bytes } = await materialize({
      original: secret,
      assets: new Map([['bitmap', png]]),
      state: stateAt(2, [rasterEdit('o0', [])], 1),
    });
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(2);
    expect(Math.round(out.getPage(1).getWidth())).toBe(400);
  });

  it('undoing the redaction gives the file back byte for byte', async () => {
    const edits: Edit[] = [rasterEdit('o0', [{ x: 30, y: 110, width: 220, height: 40 }])];
    const { bytes: undone } = await materialize({
      original: secret,
      assets: new Map([['bitmap', png]]),
      state: stateAt(2, edits, 0),
    });
    expect(Array.from(undone)).toEqual(Array.from(secret));
  });

  it('lists the pages that were painted, and only those', async () => {
    const state = stateAt(
      2,
      [rasterEdit('o0', [{ x: 1, y: 1, width: 2, height: 2 }]), rasterEdit('o1', [])],
      2
    );
    // A page turned into a picture with nothing painted out has nothing to
    // prove, so it is not something the export needs to check.
    expect(redactedPages(state).map((entry) => entry.page)).toEqual(['o0']);
  });
});

describe('flattening a form', () => {
  it('leaves the value readable and the field no longer fillable', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const form = doc.getForm();
    const field = form.createTextField('nombre');
    field.setText('Tobías');
    field.addToPage(page, { x: 40, y: 200, width: 200, height: 24 });
    const original = (await doc.save()).slice();

    const { bytes } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(1, [{ kind: 'flattenForms', on: true }], 1),
    });
    const out = await PDFDocument.load(bytes);

    expect(out.getForm().getFields()).toHaveLength(0);

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const document = await task.promise;
    const content = await (await document.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    await task.destroy();

    expect(text).toContain('Tob');
  });

  it('takes the flattening back cleanly', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const field = doc.getForm().createTextField('nombre');
    field.setText('Ana');
    field.addToPage(page, { x: 40, y: 200, width: 200, height: 24 });
    const original = (await doc.save()).slice();

    const edits: Edit[] = [
      { kind: 'flattenForms', on: true },
      { kind: 'flattenForms', on: false },
    ];
    const { bytes } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(1, edits, 2),
    });
    expect(Array.from(bytes)).toEqual(Array.from(original));
  });
});

/**
 * The risk this stage was warned about, tested directly.
 *
 * Rasterising a page unlinks its content, its fonts and its images, and the
 * collector then removes whatever nothing points at any more. The catastrophic
 * failure is obvious: a font or an image that a DIFFERENT page still uses gets
 * swept up with them, and an untouched page comes out blank or the file will
 * not open. Reachability is what protects against that — so it has to be shown
 * working on a document that genuinely shares things between pages, not on the
 * one-object-per-page documents the rest of these tests build.
 */
describe('a document whose pages share their resources', () => {
  /** Every embedded image in a file, by pixel width — a handle to tell them apart. */
  async function imageWidths(bytes: Uint8Array): Promise<number[]> {
    const { PDFStream, PDFNumber } = await import('pdf-lib');
    const document = await PDFDocument.load(bytes);
    const widths: number[] = [];
    for (const [, object] of document.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFStream)) continue;
      if (object.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
      const width = object.dict.get(PDFName.of('Width'));
      if (width instanceof PDFNumber) widths.push(width.asNumber());
    }
    return widths.sort((a, b) => a - b);
  }

  it('keeps what the untouched page still needs, and drops only what it does not', async () => {
    const doc = await PDFDocument.create();
    // One font object drawn on both pages: pdf-lib embeds it once, and both
    // pages name the same reference.
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const shared = await doc.embedPng(await makePng(12, 10));
    const solo = await doc.embedPng(await makePng(5, 4));

    const first = doc.addPage([400, 300]);
    first.drawText('SECRETO', { x: 40, y: 120, size: 18, font });
    first.drawImage(shared, { x: 200, y: 40, width: 60, height: 50 });
    first.drawImage(solo, { x: 300, y: 40, width: 50, height: 40 });

    const second = doc.addPage([400, 300]);
    second.drawText('SOBREVIVE', { x: 40, y: 240, size: 18, font });
    second.drawImage(shared, { x: 200, y: 40, width: 60, height: 50 });

    const original = (await doc.save()).slice();
    expect(await imageWidths(original)).toEqual([5, 12]);

    const { bytes } = await materialize({
      original,
      assets: new Map([['bitmap', png]]),
      state: stateAt(
        2,
        [
          {
            kind: 'raster',
            page: 'o0',
            raster: { asset: 'bitmap', boxes: [{ x: 30, y: 110, width: 220, height: 40 }] },
          },
        ],
        1
      ),
    });

    // The image only the redacted page used is gone; the one the other page
    // still uses stayed; and the bitmap that replaced the page is there.
    expect(await imageWidths(bytes)).toEqual([8, 12]);

    // Structure is not the claim, though — what matters is that the untouched
    // page still draws. A collected font would leave this text unreadable.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const document = await task.promise;
    const page = await document.getPage(2);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    // Asking for the operator list makes pdf.js resolve the page's resources
    // for real: a reference to a swept-up object throws here, not earlier.
    const operators = await page.getOperatorList();
    await task.destroy();

    expect(text).toContain('SOBREVIVE');
    expect(operators.fnArray.length).toBeGreaterThan(0);

    // The point of the whole exercise, restated on this document.
    const whole = Buffer.from(bytes).toString('latin1');
    expect(whole.includes('SECRETO')).toBe(false);
  }, 60000);

  it('takes a field out when its page is DELETED, not only when it is redacted', async () => {
    // Same defect, other door. Redaction was fixed first because that is where
    // it was found; deleting a page emptied its annotations the same way and
    // left the field, with its value, hanging off the form. Both now go through
    // src/lib/acroform.ts, so neither can be fixed without the other.
    const doc = await PDFDocument.create();
    doc.addPage([400, 300]);
    const second = doc.addPage([400, 300]);
    const field = doc.getForm().createTextField('paciente');
    field.setText('JuanPerezDNI12345678');
    field.addToPage(second, { x: 40, y: 200, width: 300, height: 24 });
    const original = (await doc.save()).slice();

    const { bytes } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(2, [{ kind: 'delete', page: 'o1' }], 1),
    });

    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
    expect(out.getForm().getFields().map((each) => each.getName())).toEqual([]);

    // A dictionary, not a stream: searching the raw bytes and the decompressed
    // streams finds nothing here and proves nothing.
    let all = Buffer.from(bytes).toString('latin1');
    for (const [, object] of out.context.enumerateIndirectObjects()) all += object.toString();
    let hex = 'FEFF';
    for (const character of 'JuanPerezDNI12345678') {
      hex += character.charCodeAt(0).toString(16).padStart(4, '0');
    }
    expect(all.toUpperCase()).not.toContain(hex.toUpperCase());
  }, 60000);

  it('leaves the form alone when the page beside it is redacted', async () => {
    // A field's appearance names a font in the AcroForm's own resources, which
    // no page's resources mentions. Unlinking a page must not take it with it:
    // the field would keep its value and have nothing to draw it.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([400, 300]).drawText('SECRETO', { x: 40, y: 120, size: 18, font });
    const second = doc.addPage([400, 300]);
    const field = doc.getForm().createTextField('nombre');
    field.setText('Ana');
    field.addToPage(second, { x: 40, y: 200, width: 200, height: 24 });
    const original = (await doc.save()).slice();

    const { bytes } = await materialize({
      original,
      assets: new Map([['bitmap', png]]),
      state: stateAt(2, [{ kind: 'raster', page: 'o0', raster: { asset: 'bitmap', boxes: [] } }], 1),
    });

    const out = await PDFDocument.load(bytes);
    const check = out.getForm().getTextField('nombre');
    expect(check.getText()).toBe('Ana');
    const widgets = check.acroField.getWidgets();
    expect(widgets.length).toBe(1);
    expect(widgets[0].getAppearances()?.normal).toBeDefined();
  }, 60000);
});

/**
 * Two defects the review found on code that had already been checked by hand,
 * and that nothing here would have caught. Both are kept as tests because both
 * were silent: the file came out looking right.
 */
describe('what the adversarial pass found', () => {
  /** Everything in the file, streams decompressed — the only honest haystack. */
  async function everywhere(bytes: Uint8Array): Promise<string> {
    const { PDFRawStream, PDFStream } = await import('pdf-lib');
    const { inflateSync } = await import('node:zlib');
    const document = await PDFDocument.load(bytes);
    let all = Buffer.from(bytes).toString('latin1');
    for (const [, object] of document.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFStream)) continue;
      try {
        const contents =
          object instanceof PDFRawStream ? object.contents : object.getContents();
        const buffer = Buffer.from(contents);
        all += object.dict.get(PDFName.of('Filter'))
          ? inflateSync(buffer).toString('latin1')
          : buffer.toString('latin1');
      } catch {
        /* An opaque stream cannot hide text a reader could recover either. */
      }
    }
    return all;
  }

  it('a filled field on the redacted page leaves with it', async () => {
    // The bad version: deleting the page's annotations removed the widget, but
    // the field kept its value in the form. The page was a picture, the value
    // was still in the file — and the export's own check could not see it,
    // because a field with no widget draws no text for pdf.js to read. It would
    // have reported the page clean.
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const field = doc.getForm().createTextField('titular');
    field.setText('MarianaBelforte');
    field.addToPage(page, { x: 40, y: 200, width: 200, height: 24 });
    doc.addPage([400, 300]);
    const original = (await doc.save()).slice();

    const { bytes } = await materialize({
      original,
      assets: new Map([['bitmap', png]]),
      state: stateAt(
        2,
        [
          {
            kind: 'raster',
            page: 'o0',
            raster: { asset: 'bitmap', boxes: [{ x: 30, y: 190, width: 220, height: 40 }] },
          },
        ],
        1
      ),
    });

    const haystack = await everywhere(bytes);
    const hex = Buffer.from('MarianaBelforte', 'latin1').toString('hex').toUpperCase();
    expect(haystack.includes('MarianaBelforte')).toBe(false);
    expect(haystack.toUpperCase().includes(hex)).toBe(false);

    const out = await PDFDocument.load(bytes);
    expect(out.getForm().getFields().map((each) => each.getName())).toEqual([]);
  }, 60000);

  it('but a field on a page still standing is left alone', async () => {
    // The other half, and the one that makes the fix a fix rather than a
    // scorched-earth delete: removing more than the redacted page's own fields
    // would quietly break every form beside it.
    const doc = await PDFDocument.create();
    const first = doc.addPage([400, 300]);
    const second = doc.addPage([400, 300]);
    const form = doc.getForm();

    const doomed = form.createTextField('en_la_tachada');
    doomed.setText('SEVA');
    doomed.addToPage(first, { x: 40, y: 200, width: 200, height: 24 });

    const spared = form.createTextField('en_la_otra');
    spared.setText('SEQUEDA');
    spared.addToPage(second, { x: 40, y: 200, width: 200, height: 24 });

    const original = (await doc.save()).slice();

    const { bytes } = await materialize({
      original,
      assets: new Map([['bitmap', png]]),
      state: stateAt(2, [{ kind: 'raster', page: 'o0', raster: { asset: 'bitmap', boxes: [] } }], 1),
    });

    const out = await PDFDocument.load(bytes);
    expect(out.getForm().getFields().map((each) => each.getName())).toEqual(['en_la_otra']);
    expect(out.getForm().getTextField('en_la_otra').getText()).toBe('SEQUEDA');

    const haystack = await everywhere(bytes);
    expect(haystack.includes('SEVA')).toBe(false);
  }, 60000);

  it('flattening bakes in what the reader typed, not what arrived', async () => {
    // The bad version flattened BEFORE regenerating appearances, so it copied
    // the appearance the document came with. The reader's value was in the
    // file and nothing drew it: the field said NUEVO and the page said VIEJO.
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const field = doc.getForm().createTextField('nombre');
    field.setText('VIEJO');
    field.addToPage(page, { x: 40, y: 200, width: 200, height: 24 });
    const original = (await doc.save()).slice();

    const { bytes } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(
        1,
        [
          { kind: 'setField', field: 'nombre', value: 'NUEVO' },
          { kind: 'flattenForms', on: true },
        ],
        2
      ),
    });

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const opened = await task.promise;
    const content = await (await opened.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    await task.destroy();

    expect(text).toContain('NUEVO');
    expect(text).not.toContain('VIEJO');
  }, 60000);
});

/**
 * The bitmap and the page it goes into have to be the same shape.
 *
 * The bitmap is rendered from the script state, so it already carries the
 * reader's crop and turns. If the page it is drawn into is sized from the
 * ORIGINAL box instead, the picture is stretched to fit — and nothing catches
 * it: the painted regions are still black, so the export check passes and the
 * distorted file is handed over as correct.
 */
describe('a page that was cropped or turned before it was redacted', () => {
  /** What materialize would hand pdf.js: the visible box, after rotation. */
  async function visibleSize(bytes: Uint8Array, index: number) {
    const document = await PDFDocument.load(bytes);
    const page = document.getPages()[index];
    const { width, height } = page.getSize();
    const angle = ((page.getRotation().angle % 360) + 360) % 360;
    return angle === 90 || angle === 270
      ? { width: height, height: width, angle }
      : { width, height, angle };
  }

  it('comes out the size it looked cropped, not the size it started', async () => {
    const original = await (async () => {
      const doc = await PDFDocument.create();
      doc.addPage([400, 300]);
      doc.addPage([400, 300]);
      return (await doc.save()).slice();
    })();

    const { bytes } = await materialize({
      original,
      assets: new Map([['bitmap', png]]),
      state: stateAt(
        2,
        [
          { kind: 'crop', page: 'o0', box: { x: 50, y: 40, width: 120, height: 200 } },
          { kind: 'raster', page: 'o0', raster: { asset: 'bitmap', boxes: [] } },
        ],
        2
      ),
    });

    const size = await visibleSize(bytes, 0);
    expect(size.angle).toBe(0);
    expect(Math.round(size.width)).toBe(120);
    expect(Math.round(size.height)).toBe(200);
  }, 60000);

  it('comes out the size it looked turned, not the size it started', async () => {
    const original = await (async () => {
      const doc = await PDFDocument.create();
      doc.addPage([400, 300]);
      return (await doc.save()).slice();
    })();

    const { bytes } = await materialize({
      original,
      assets: new Map([['bitmap', png]]),
      state: stateAt(
        1,
        [
          { kind: 'rotate', page: 'o0', turns: 1 },
          { kind: 'raster', page: 'o0', raster: { asset: 'bitmap', boxes: [] } },
        ],
        2
      ),
    });

    // A quarter turn of a 400x300 page looks 300x400. The page must be that,
    // flat — not 400x300 with the picture squashed into it.
    const size = await visibleSize(bytes, 0);
    expect(size.angle).toBe(0);
    expect(Math.round(size.width)).toBe(300);
    expect(Math.round(size.height)).toBe(400);
  }, 60000);

  it('handles both at once, in the order the reader did them', async () => {
    const original = await (async () => {
      const doc = await PDFDocument.create();
      doc.addPage([400, 300]);
      return (await doc.save()).slice();
    })();

    const { bytes } = await materialize({
      original,
      assets: new Map([['bitmap', png]]),
      state: stateAt(
        1,
        [
          { kind: 'crop', page: 'o0', box: { x: 0, y: 0, width: 200, height: 100 } },
          { kind: 'rotate', page: 'o0', turns: 1 },
          { kind: 'raster', page: 'o0', raster: { asset: 'bitmap', boxes: [] } },
        ],
        3
      ),
    });

    const size = await visibleSize(bytes, 0);
    expect(size.angle).toBe(0);
    expect(Math.round(size.width)).toBe(100);
    expect(Math.round(size.height)).toBe(200);
  }, 60000);
});
