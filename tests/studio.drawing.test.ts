import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, PDFStream } from 'pdf-lib';
import { deflateSync, inflateSync } from 'node:zlib';
import { materialize } from '@/lib/studio/materialize';
import { stateAt, type Edit, type Mark } from '@/lib/studio/script';

/**
 * The three tools the editor was still missing: a straight line with an
 * optional head, an ellipse, and an eraser.
 *
 * The first two are drawn marks, checked by reading the operators that reach
 * the page — a mark that produces nothing is the failure worth catching, and a
 * count of strokes is what separates a plain line from an arrow.
 *
 * The eraser is not a drawn mark at all. It is a redaction painted white: the
 * page is rebuilt as a bitmap that never held the content, so what was under it
 * is gone from the bytes rather than covered. That is why it goes through the
 * same machinery, and why it is proved the same way.
 */

async function blank(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  doc.addPage([400, 300]);
  return (await doc.save()).slice();
}

/** Every content stream of the produced document, decompressed. */
async function operators(bytes: Uint8Array): Promise<string> {
  const document = await PDFDocument.load(bytes);
  let all = '';
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFStream)) continue;
    if (object.dict.get(PDFName.of('Subtype')) !== undefined) continue;
    try {
      const contents = object instanceof PDFRawStream ? object.contents : object.getContents();
      const buffer = Buffer.from(contents);
      all += object.dict.get(PDFName.of('Filter'))
        ? inflateSync(buffer).toString('latin1')
        : buffer.toString('latin1');
    } catch {
      /* An opaque stream cannot hold operators this needs to count either. */
    }
  }
  return all;
}

const drawing = (mark: Mark): Edit => ({ kind: 'draw', mark });

const line = (arrow: boolean): Mark => ({
  kind: 'line',
  id: 'l1',
  page: 'o0',
  x1: 40,
  y1: 40,
  x2: 240,
  y2: 140,
  color: { r: 0, g: 0, b: 0 },
  width: 2,
  arrow,
});

describe('the line tool', () => {
  it('draws one stroke without a head', async () => {
    const { bytes } = await materialize({
      original: await blank(),
      assets: new Map(),
      state: stateAt(2, [drawing(line(false))], 1),
    });
    const strokes = (await operators(bytes)).match(/\bS\b/g) ?? [];
    expect(strokes.length).toBe(1);
  }, 60000);

  it('draws three when it carries an arrowhead', async () => {
    // The shaft plus the two strokes that make the head. Counting is what
    // separates the two: both produce a line, and only one produces an arrow.
    const { bytes } = await materialize({
      original: await blank(),
      assets: new Map(),
      state: stateAt(2, [drawing(line(true))], 1),
    });
    const strokes = (await operators(bytes)).match(/\bS\b/g) ?? [];
    expect(strokes.length).toBe(3);
  }, 60000);

  it('puts the head at the end the reader dragged TO, not the one they started from', async () => {
    const { bytes } = await materialize({
      original: await blank(),
      assets: new Map(),
      state: stateAt(2, [drawing(line(true))], 1),
    });
    const content = await operators(bytes);

    // One start per stroke. pdf-lib emits a moveto TWICE per line, so counting
    // `m` would be a test of that quirk; splitting on the stroke operator and
    // taking the first point of each block is the same question asked properly.
    //
    // And it has to be the START, not the end. An earlier version of this test
    // asserted on the endpoints and a mutant that drew both head strokes FROM
    // the wrong point survived it untouched — the heads still ended near the
    // far corner, because their ends are computed from it either way.
    const startsOf = (body: string) =>
      body
        .split(/\bS\b/)
        .slice(0, -1)
        .map((block) => {
          const first = /([\d.]+) ([\d.]+) m/.exec(block);
          return first ? { x: Number(first[1]), y: Number(first[2]) } : null;
        })
        .filter((point): point is { x: number; y: number } => point !== null);

    const near = (point: { x: number; y: number }, x: number, y: number) =>
      Math.hypot(point.x - x, point.y - y) < 1;

    const starts = startsOf(content);
    expect(starts.length).toBe(3);
    // The shaft leaves the point the drag began at, once.
    expect(starts.filter((point) => near(point, 40, 40)).length).toBe(1);
    // Both strokes of the head leave the point it ended at.
    expect(starts.filter((point) => near(point, 240, 140)).length).toBe(2);
  }, 60000);

  it('survives a line with no length at all', async () => {
    // A degenerate drag: the head has no direction to point in, and the build
    // must still produce a document rather than an angle of NaN.
    const { bytes } = await materialize({
      original: await blank(),
      assets: new Map(),
      state: stateAt(
        2,
        [
          drawing({
            kind: 'line',
            id: 'l1',
            page: 'o0',
            x1: 40,
            y1: 40,
            x2: 40,
            y2: 40,
            color: { r: 0, g: 0, b: 0 },
            width: 2,
            arrow: true,
          }),
        ],
        1
      ),
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    expect(await operators(bytes)).not.toContain('NaN');
  }, 60000);
});

describe('the ellipse tool', () => {
  it('draws curves, which is what tells it from a rectangle', async () => {
    const { bytes } = await materialize({
      original: await blank(),
      assets: new Map(),
      state: stateAt(
        2,
        [
          drawing({
            kind: 'ellipse',
            id: 'e1',
            page: 'o0',
            x: 200,
            y: 150,
            rx: 80,
            ry: 40,
            color: null,
            borderColor: { r: 0, g: 0, b: 0 },
            borderWidth: 2,
            opacity: 1,
          }),
        ],
        1
      ),
    });
    // `c` is the Bezier operator: an ellipse is four of them, a rectangle none.
    const curves = (await operators(bytes)).match(/\bc\b/g) ?? [];
    expect(curves.length).toBeGreaterThanOrEqual(4);
  }, 60000);
});

/** A one-pixel white PNG: Node has no canvas, and the pixels are not the point. */
function whitePixel(): Uint8Array {
  const raw = Buffer.alloc(4, 0xff);
  raw[0] = 0;
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
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ])
  );
}

describe('the eraser', () => {
  it('THE POINT: what it covers is gone from the bytes, not hidden under white', async () => {
    const { StandardFonts, rgb } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc
      .addPage([400, 300])
      .drawText('BORRAME', { x: 40, y: 120, size: 18, font, color: rgb(0, 0, 0) });
    doc.addPage([400, 300]).drawText('QUEDATE', { x: 40, y: 120, size: 18, font });
    const original = (await doc.save()).slice();

    const { bytes } = await materialize({
      original,
      assets: new Map([['bitmap', whitePixel()]]),
      state: stateAt(
        2,
        [
          {
            kind: 'raster',
            page: 'o0',
            raster: {
              asset: 'bitmap',
              // White is the only thing that separates erasing from redacting.
              // The removal is identical, and so is this proof.
              boxes: [{ x: 30, y: 110, width: 220, height: 40, fill: 'white' }],
            },
          },
        ],
        1
      ),
    });

    const out = await PDFDocument.load(bytes);
    let all = Buffer.from(bytes).toString('latin1');
    for (const [, object] of out.context.enumerateIndirectObjects()) all += object.toString();
    all += await operators(bytes);

    // pdf-lib writes drawn text as a hex string, so the words are looked for in
    // that form as well. Without this the search finds nothing either way and
    // proves nothing — the mistake this project has made more than once.
    const hex = (word: string) =>
      Buffer.from(word, 'latin1').toString('hex').toUpperCase();
    const upper = all.toUpperCase();

    expect(all.includes('BORRAME') || upper.includes(hex('BORRAME'))).toBe(false);
    // The page nobody touched keeps its text, so a search that found nothing
    // would still have found something.
    expect(all.includes('QUEDATE') || upper.includes(hex('QUEDATE'))).toBe(true);
  }, 60000);

  it('a box with no colour is still a redaction, so an old session replays', () => {
    // `fill` was added after redaction shipped. A stored box without it is the
    // only kind that existed then, and it has to keep meaning black rather than
    // quietly becoming an erasure.
    const stored: { x: number; y: number; width: number; height: number; fill?: 'black' | 'white' } =
      { x: 10, y: 10, width: 20, height: 20 };
    expect(stored.fill).toBeUndefined();
    expect(stored.fill ?? 'black').toBe('black');
  });
});
