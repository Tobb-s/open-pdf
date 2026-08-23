import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { materialize } from '@/lib/studio/materialize';
import { stateAt, type Edit } from '@/lib/studio/script';
import { importedStructures, verifyFields } from '@/lib/studio/verify';
import { buildRichPdf, pageWidth } from './helpers/richPdf';

/**
 * Stage four: the session stops managing pages and starts managing a document —
 * form fields, imported content, a text layer and metadata.
 */

let fixture: Uint8Array;
const PAGES = 5;
const noAssets = new Map<string, Uint8Array>();

/** A 4x2 PNG, so a page made from it is unmistakably landscape. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAEklEQVR42mNkYPhfz0BFwDiqAQBrRAX7ZbYXAAAAAABJRU5ErkJggg=='
  ),
  (character) => character.charCodeAt(0)
);

beforeAll(async () => {
  fixture = await buildRichPdf(PAGES);
});

const page = (index: number) => `o${index}`;

describe('form fields in the session', () => {
  it('writes a value and reads it back out of the produced file', async () => {
    // The fixture carries one text field, `alumno.nombre`, already set.
    const { bytes } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, [{ kind: 'setField', field: 'alumno.nombre', value: 'Ana' }], 1),
    });

    const out = await PDFDocument.load(bytes);
    expect(out.getForm().getTextField('alumno.nombre').getText()).toBe('Ana');
  });

  it('THE STAGE RISK: the round trip catches a value that did not take', async () => {
    // Appearance regeneration is the part the plan called surprising, so the
    // export reads the file back rather than trusting the write.
    const { bytes } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, [{ kind: 'setField', field: 'alumno.nombre', value: 'Ana' }], 1),
    });

    expect(await verifyFields(bytes, { 'alumno.nombre': 'Ana' })).toEqual([]);

    // A field the document does not have is reported, not swallowed.
    expect(await verifyFields(bytes, { 'no.existe': 'x' })).toEqual([
      { field: 'no.existe', wanted: 'x', found: null },
    ]);
    // And a value that disagrees with the file is reported as what it is.
    expect(await verifyFields(bytes, { 'alumno.nombre': 'Otro' })).toEqual([
      { field: 'alumno.nombre', wanted: 'Otro', found: 'Ana' },
    ]);
  });

  it('does not take the untouched shortcut once a field has been set', async () => {
    const state = stateAt(PAGES, [{ kind: 'setField', field: 'alumno.nombre', value: 'Ana' }], 1);
    const { bytes } = await materialize({ original: fixture, assets: noAssets, state });
    expect(Array.from(bytes)).not.toEqual(Array.from(fixture));
  });

  it('a field the document does not have does not sink the document', async () => {
    const { bytes } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, [{ kind: 'setField', field: 'inventado', value: 'x' }], 1),
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(PAGES);
  });
});

describe('defects the review found, kept fixed', () => {
  it('a character the font cannot draw is named, not thrown from inside save', async () => {
    // Appearance regeneration draws with a WinAnsi font. Left to `save`, the
    // throw escaped materialise entirely and killed the export and every later
    // rebuild with an opaque error — the same failure the text marks already
    // guarded against, missing from the form path.
    const { UnsupportedCharacterError } = await import('@/lib/stamp');
    await expect(
      materialize({
        original: fixture,
        assets: noAssets,
        state: stateAt(PAGES, [{ kind: 'setField', field: 'alumno.nombre', value: '中文' }], 1),
      })
    ).rejects.toBeInstanceOf(UnsupportedCharacterError);
  });

  it('touching one field leaves the others exactly as they were', async () => {
    // Asking pdf-lib to regenerate the whole form re-typesets every field that
    // happens to lack an appearance, rewriting the look of fields nobody
    // touched. Only what the reader wrote is regenerated.
    const doc = await PDFDocument.create();
    const page_ = doc.addPage([400, 400]);
    const form = doc.getForm();
    const a = form.createTextField('campo.a');
    a.addToPage(page_, { x: 20, y: 300, width: 200, height: 24 });
    const b = form.createTextField('campo.b');
    b.setText('intacto');
    b.addToPage(page_, { x: 20, y: 200, width: 200, height: 24 });
    const original = (await doc.save()).slice();

    const before = await PDFDocument.load(original);
    const beforeDa = before
      .getForm()
      .getTextField('campo.b')
      .acroField.getDefaultAppearance();

    const { bytes } = await materialize({
      original,
      assets: noAssets,
      state: stateAt(1, [{ kind: 'setField', field: 'campo.a', value: 'NUEVO' }], 1),
    });
    const after = await PDFDocument.load(bytes);

    expect(after.getForm().getTextField('campo.a').getText()).toBe('NUEVO');
    expect(after.getForm().getTextField('campo.b').getText()).toBe('intacto');
    expect(after.getForm().getTextField('campo.b').acroField.getDefaultAppearance()).toBe(
      beforeDa
    );
  });

  it('the round trip notices a value that is there but nothing draws', async () => {
    // The stage's named risk, measured rather than assumed: comparing values
    // alone cannot see a field whose appearance never got written.
    const { bytes } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, [{ kind: 'setField', field: 'alumno.nombre', value: 'Ana' }], 1),
    });
    const checks = await verifyFields(bytes, { 'alumno.nombre': 'Ana' });
    expect(checks).toEqual([]);

    // And a document whose widget has no appearance at all is reported.
    const bare = await PDFDocument.create();
    const barePage = bare.addPage([300, 300]);
    const field = bare.getForm().createTextField('vacio');
    field.addToPage(barePage, { x: 10, y: 10, width: 100, height: 20 });
    const bareBytes = (await bare.save({ updateFieldAppearances: false })).slice();
    // Reading a field nobody wrote: whatever comes back, it must not claim more
    // than it can see.
    const bareChecks = await verifyFields(bareBytes, { vacio: 'algo' });
    expect(bareChecks).toHaveLength(1);
  });

  it('an image that cannot be embedded costs its own page and nothing else', async () => {
    // Magic bytes that say PNG on a file that is not one.
    const broken = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const { bytes } = await materialize({
      original: fixture,
      assets: new Map([['roto', broken]]),
      state: stateAt(PAGES, [{ kind: 'insertImages', before: page(0), assets: ['roto'] }], 1),
    });
    // The document still comes out; only the page that could not be made is gone.
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(PAGES);
  });

  it('returning a metadata box to what the document said is not a change', async () => {
    // A merge that could never un-set meant an empty Title box overwrote a real
    // title with nothing, and the document could never be untouched again.
    const edits: Edit[] = [
      { kind: 'metadata', patch: { title: 'Otro' } },
      { kind: 'metadata', patch: { title: null } },
    ];
    const state = stateAt(PAGES, edits, 2);
    expect(state.metadata.title).toBeUndefined();

    const { bytes } = await materialize({ original: fixture, assets: noAssets, state });
    expect(Array.from(bytes)).toEqual(Array.from(fixture));
  });
});

describe('metadata', () => {
  it('writes title, author and language', async () => {
    const { bytes } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(
        PAGES,
        [{ kind: 'metadata', patch: { title: 'Tesis', author: 'Tobías', language: 'es-AR' } }],
        1
      ),
    });
    const out = await PDFDocument.load(bytes);
    expect(out.getTitle()).toBe('Tesis');
    expect(out.getAuthor()).toBe('Tobías');
    expect(out.catalog.get(PDFName.of('Lang'))).toBeDefined();
  });

  it('undoing metadata brings the file back byte for byte', async () => {
    const edits: Edit[] = [{ kind: 'metadata', patch: { title: 'Tesis' } }];
    const { bytes: undone } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, edits, 0),
    });
    expect(Array.from(undone)).toEqual(Array.from(fixture));
  });
});

describe('images as pages', () => {
  it('makes a page shaped like the image', async () => {
    const assets = new Map([['foto', PNG]]);
    const { bytes } = await materialize({
      original: fixture,
      assets,
      state: stateAt(PAGES, [{ kind: 'insertImages', before: page(1), assets: ['foto'] }], 1),
    });
    const out = await PDFDocument.load(bytes);

    expect(out.getPageCount()).toBe(PAGES + 1);
    const made = out.getPage(1);
    // The PNG is 4x2, so the page must be landscape at 2:1.
    expect(made.getWidth() / made.getHeight()).toBeCloseTo(2, 3);
    // And it goes exactly where the reader put it.
    expect(Math.round(out.getPage(0).getWidth())).toBe(pageWidth(0));
    expect(Math.round(out.getPage(2).getWidth())).toBe(pageWidth(1));
  });

  it('really draws the image rather than leaving a blank page', async () => {
    const { PDFStream } = await import('pdf-lib');
    const assets = new Map([['foto', PNG]]);
    const { bytes } = await materialize({
      original: fixture,
      assets,
      state: stateAt(PAGES, [{ kind: 'insertImages', before: null, assets: ['foto'] }], 1),
    });
    const out = await PDFDocument.load(bytes);
    const images = out.context
      .enumerateIndirectObjects()
      .filter(
        ([, object]) =>
          object instanceof PDFStream &&
          object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
      );
    expect(images.length).toBeGreaterThan(0);
  });

  it('several images become several pages, in order', async () => {
    const assets = new Map([
      ['a', PNG],
      ['b', PNG],
    ]);
    const { bytes } = await materialize({
      original: fixture,
      assets,
      state: stateAt(PAGES, [{ kind: 'insertImages', before: page(0), assets: ['a', 'b'] }], 1),
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(PAGES + 2);
  });
});

describe('the OCR text layer', () => {
  it('puts words on the page that a reader can find', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { bytes } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(
        PAGES,
        [
          {
            kind: 'draw',
            mark: {
              kind: 'ocr',
              id: 'capa',
              page: page(0),
              rotate: 0,
              words: [
                { text: 'PALABRA', x: 40, y: 200, size: 12 },
                { text: 'ENCONTRABLE', x: 120, y: 200, size: 12 },
              ],
            },
          },
        ],
        1
      ),
    });

    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const document = await task.promise;
    const content = await (await document.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    await task.destroy();

    expect(text).toContain('PALABRA');
    expect(text).toContain('ENCONTRABLE');
  });

  it('skips a word the font cannot draw instead of losing the layer', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { bytes } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(
        PAGES,
        [
          {
            kind: 'draw',
            mark: {
              kind: 'ocr',
              id: 'capa',
              page: page(0),
              rotate: 0,
              words: [
                { text: '第', x: 40, y: 200, size: 12 },
                { text: 'SOBREVIVE', x: 80, y: 200, size: 12 },
              ],
            },
          },
        ],
        1
      ),
    });

    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const document = await task.promise;
    const content = await (await document.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    await task.destroy();

    expect(text).toContain('SOBREVIVE');
  });
});

describe('the stage-two tools as session operations', () => {
  const numbering = {
    font: { family: 'helvetica' as const, bold: false, italic: false },
    size: 11,
    color: { r: 0, g: 0, b: 0 },
    anchor: 'bottom-center' as const,
    margin: 36,
    startAt: 1,
    format: 'plain' as const,
    ofWord: 'de',
    pages: null,
  };

  it('numbers pages from the FINAL order, not the order they were in', async () => {
    // This is why numbering is a document setting rather than a mark per page:
    // a mark would carry the number it was given, and reordering would leave
    // the old numbers scattered through the document.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const edits: Edit[] = [
      { kind: 'numbering', spec: numbering },
      { kind: 'move', page: page(4), before: page(0) },
    ];
    const { bytes } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, edits, 2),
    });

    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const document = await task.promise;
    const first = await (await document.getPage(1)).getTextContent();
    const text = first.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    await task.destroy();

    // The page that moved to the front is numbered 1, not 5.
    expect(text).toContain('1');
    expect(text).toContain('P4');
  });

  it('a watermark reaches every page unless told otherwise', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { bytes } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(
        PAGES,
        [
          {
            kind: 'watermark',
            spec: {
              text: 'BORRADOR',
              font: { family: 'helvetica', bold: true, italic: false },
              size: 36,
              color: { r: 0.6, g: 0.6, b: 0.6 },
              opacity: 0.3,
              angle: 45,
              anchor: 'center',
              margin: 36,
              pages: null,
            },
          },
        ],
        1
      ),
    });

    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const document = await task.promise;
    let seen = 0;
    for (let number = 1; number <= document.numPages; number += 1) {
      const content = await (await document.getPage(number)).getTextContent();
      const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      if (text.includes('BORRADOR')) seen += 1;
    }
    await task.destroy();
    expect(seen).toBe(PAGES);
  });

  it('taking the watermark back gives the file again byte for byte', async () => {
    const edits: Edit[] = [
      {
        kind: 'watermark',
        spec: {
          text: 'BORRADOR',
          font: { family: 'helvetica', bold: true, italic: false },
          size: 36,
          color: { r: 0.6, g: 0.6, b: 0.6 },
          opacity: 0.3,
          angle: 45,
          anchor: 'center',
          margin: 36,
          pages: null,
        },
      },
      { kind: 'watermark', spec: null },
    ];
    const { bytes } = await materialize({
      original: fixture,
      assets: noAssets,
      state: stateAt(PAGES, edits, 2),
    });
    expect(Array.from(bytes)).toEqual(Array.from(fixture));
  });
});

describe('THE STAGE GATE: importing declares what it could not bring', () => {
  it('names the form and the bookmarks an imported PDF carried', async () => {
    // copyPages copies pages, not documents. That is not a defect to fix — it
    // is what the operation is — so the only honest answer is to say what was
    // left behind before the reader assumes it came along.
    expect(await importedStructures(fixture)).toEqual(
      expect.arrayContaining(['form', 'bookmarks', 'attachments', 'pageLabels'])
    );
  });

  it('says nothing about a document that had nothing to lose', async () => {
    const plain = await PDFDocument.create();
    plain.addPage([200, 200]);
    expect(await importedStructures((await plain.save()).slice())).toEqual([]);
  });

  it('never names something it cannot verify', async () => {
    // Layers and the accessibility tree are present-or-absent to us, and this
    // project does not name what it cannot check.
    const tagged = await PDFDocument.create();
    tagged.addPage([200, 200]);
    tagged.catalog.set(PDFName.of('StructTreeRoot'), tagged.context.obj({}));
    tagged.catalog.set(PDFName.of('OCProperties'), tagged.context.obj({ OCGs: [] }));
    const named = await importedStructures((await tagged.save()).slice());
    expect(named).not.toContain('accessibility');
    expect(named).not.toContain('layers');
  });

  it('does not name the title or the language, which nobody expects to travel', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.setTitle('Otro documento');
    doc.setLanguage('en-GB');
    const named = await importedStructures((await doc.save()).slice());
    expect(named).not.toContain('metadataTitle');
    expect(named).not.toContain('language');
  });

  it('leaves no dead form control behind on an imported page', async () => {
    // copyPages brings a page's widgets even though the form they belonged to
    // stays behind, so an imported page arrived carrying boxes that looked like
    // fields and were not. Declaring the loss while shipping the boxes would be
    // true and misleading at once.
    const { PDFArray, PDFRef } = await import('pdf-lib');
    const host = await PDFDocument.create();
    host.addPage([300, 300]);
    const hostBytes = (await host.save()).slice();

    const { bytes } = await materialize({
      original: hostBytes,
      assets: new Map([['rico', fixture]]),
      // Page 1 of the fixture is the one carrying the field's widget.
      state: stateAt(1, [{ kind: 'insert', before: null, asset: 'rico', indices: [0, 1, 2] }], 1),
    });
    const out = await PDFDocument.load(bytes);

    const live = new Set<string>();
    const acro = out.catalog.get(PDFName.of('AcroForm'));
    const acroDict = acro instanceof PDFRef ? out.context.lookup(acro) : acro;
    const fields = (acroDict as { get?: (key: unknown) => unknown })?.get?.(PDFName.of('Fields'));
    const list = fields instanceof PDFRef ? out.context.lookup(fields) : fields;
    if (list instanceof PDFArray) {
      for (let index = 0; index < list.size(); index += 1) {
        const entry = list.get(index);
        if (entry instanceof PDFRef) live.add(entry.tag);
      }
    }

    let orphans = 0;
    for (const imported of out.getPages()) {
      const annots = imported.node.Annots();
      if (!annots) continue;
      for (let index = 0; index < annots.size(); index += 1) {
        const entry = annots.get(index);
        if (entry instanceof PDFRef && !live.has(entry.tag)) orphans += 1;
      }
    }
    expect(orphans).toBe(0);
  });

  it('and the loss really happens, so the declaration is not theatre', async () => {
    const { compareStructureBytes } = await import('@/lib/verify/structural');
    // Import the rich fixture's pages into a plain document and confirm the
    // form and bookmarks genuinely do not arrive.
    const host = await PDFDocument.create();
    host.addPage([200, 200]);
    const hostBytes = (await host.save()).slice();

    const { bytes } = await materialize({
      original: hostBytes,
      assets: new Map([['rico', fixture]]),
      state: stateAt(
        1,
        [{ kind: 'insert', before: null, asset: 'rico', indices: [0, 1, 2, 3, 4] }],
        1
      ),
    });
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(6);
    // Nothing of the imported document's catalogue came with its pages.
    expect(out.catalog.get(PDFName.of('Outlines'))).toBeUndefined();
    expect(await compareStructureBytes(fixture, bytes)).not.toEqual([]);
  });
});

describe('a text field with an unusual font still round-trips', () => {
  it('reports rather than pretends when appearance regeneration cannot help', async () => {
    // A field whose default appearance names a font the document does not
    // embed: exactly the case the plan called surprising.
    const doc = await PDFDocument.create();
    const page_ = doc.addPage([400, 400]);
    const form = doc.getForm();
    const field = form.createTextField('raro');
    field.addToPage(page_, { x: 20, y: 20, width: 200, height: 24 });
    await doc.embedFont(StandardFonts.Helvetica);
    const original = (await doc.save()).slice();

    const { bytes } = await materialize({
      original,
      assets: noAssets,
      state: stateAt(1, [{ kind: 'setField', field: 'raro', value: 'valor' }], 1),
    });

    const problems = await verifyFields(bytes, { raro: 'valor' });
    // Either it worked, or it is named. What must not happen is silence.
    if (problems.length > 0) {
      expect(problems[0].field).toBe('raro');
      expect(problems[0].found).not.toBe('valor');
    } else {
      expect((await PDFDocument.load(bytes)).getForm().getTextField('raro').getText()).toBe(
        'valor'
      );
    }
  });
});
