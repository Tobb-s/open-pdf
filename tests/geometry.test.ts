import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import {
  anchorBlock,
  clientToCanvasPoint,
  originForRotatedCenter,
  pageBoxOf,
  pdfToViewportPoint,
  uprightTextRotation,
  viewportToPdfPoint,
  visualSize,
  visualToPdfPoint,
  visualUpToPdfPoint,
  type ViewportLike,
} from '@/lib/geometry';

describe('clientToCanvasPoint', () => {
  const canvas = {
    width: 800,
    height: 600,
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 300 }),
  };

  it('rescales a click on a CSS-shrunk canvas to backing-store pixels', () => {
    // Canvas displayed at half size: a click 200px into the rect is 400 backing px.
    expect(clientToCanvasPoint(canvas, 300, 200)).toEqual({ x: 400, y: 300 });
  });

  it('maps the corners exactly', () => {
    expect(clientToCanvasPoint(canvas, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(clientToCanvasPoint(canvas, 500, 350)).toEqual({ x: 800, y: 600 });
  });
});

describe('viewport conversions', () => {
  // An arbitrary affine viewport; the wrappers must be exact inverses through it.
  const viewport: ViewportLike = {
    width: 600,
    height: 400,
    convertToPdfPoint: (x, y) => [y + 3, 600 - x / 2],
    convertToViewportPoint: (x, y) => [(600 - y) * 2, x - 3],
  };

  it('round-trips through an affine transform', () => {
    const pdf = viewportToPdfPoint(viewport, 123, 45);
    const back = pdfToViewportPoint(viewport, pdf);
    expect(back.x).toBeCloseTo(123, 8);
    expect(back.y).toBeCloseTo(45, 8);
  });
});

describe('uprightTextRotation', () => {
  it('normalizes into [0, 360)', () => {
    expect(uprightTextRotation(0)).toBe(0);
    expect(uprightTextRotation(90)).toBe(90);
    expect(uprightTextRotation(450)).toBe(90);
    expect(uprightTextRotation(-90)).toBe(270);
  });

  it('is verified against pdf.js on a real rotated page', async () => {
    // The experiment that decided the sign, kept as a regression test:
    // draw with the rule, extract with pdf.js, and require the baseline to run
    // left-to-right and level on the *rotated* screen, at the clicked point.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

    for (const pageRotate of [90, 180, 270]) {
      // Build the rotated page first so pdf.js can hand us its real viewport.
      const probe = await PDFDocument.create();
      const probePage = probe.addPage([400, 600]);
      probePage.setRotation(degrees(pageRotate));
      const probeBytes = await probe.save();

      const probeTask = pdfjs.getDocument({ data: new Uint8Array(probeBytes) });
      const viewport = (await (await probeTask.promise).getPage(1)).getViewport({ scale: 1 });
      const click = { x: 100, y: 150 };
      const target = viewportToPdfPoint(viewport, click.x, click.y);
      await probeTask.destroy();

      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage([400, 600]);
      page.setRotation(degrees(pageRotate));
      page.drawText('MARCA', {
        x: target.x,
        y: target.y,
        size: 12,
        font,
        color: rgb(0, 0, 0),
        rotate: degrees(uprightTextRotation(pageRotate)),
      });
      const bytes = await doc.save();

      const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
      const outPage = await (await task.promise).getPage(1);
      const outViewport = outPage.getViewport({ scale: 1 });
      const content = await outPage.getTextContent();
      const item = content.items.find(
        (candidate) => 'str' in candidate && candidate.str.includes('MARCA')
      ) as { transform: number[] } | undefined;

      expect(item, `pageRotate=${pageRotate}`).toBeDefined();
      const [a, b, , , e, f] = item!.transform;
      const origin = pdfToViewportPoint(outViewport, { x: e, y: f });
      const along = pdfToViewportPoint(outViewport, { x: e + a * 10, y: f + b * 10 });
      await task.destroy();

      // Lands where clicked…
      expect(origin.x, `x @ ${pageRotate}`).toBeCloseTo(click.x, 4);
      expect(origin.y, `y @ ${pageRotate}`).toBeCloseTo(click.y, 4);
      // …and reads upright: baseline runs to screen-right, level.
      expect(along.x - origin.x, `dir-x @ ${pageRotate}`).toBeGreaterThan(0);
      expect(Math.abs(along.y - origin.y), `dir-y @ ${pageRotate}`).toBeLessThan(0.01);
    }
  });
});

describe('placement in pure PDF space', () => {
  it('agrees with pdf.js for every rotation, including a shifted crop box', async () => {
    // The whole point of the pure functions is that the save path never has to
    // render anything. That is only safe if they agree with the renderer, so
    // this compares them against pdf.js's own viewport, point by point.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

    for (const rotation of [0, 90, 180, 270]) {
      for (const crop of [null, { x: 20, y: 35, width: 300, height: 500 }]) {
        const doc = await PDFDocument.create();
        const page = doc.addPage([400, 600]);
        page.setRotation(degrees(rotation));
        if (crop) page.setCropBox(crop.x, crop.y, crop.width, crop.height);
        const bytes = await doc.save();

        const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
        const jsPage = await (await task.promise).getPage(1);
        const viewport = jsPage.getViewport({ scale: 1 });

        const box = pageBoxOf(page);
        const size = visualSize(box);
        const label = `rot=${rotation} crop=${crop ? 'sí' : 'no'}`;

        expect(size.width, `ancho visual ${label}`).toBeCloseTo(viewport.width, 6);
        expect(size.height, `alto visual ${label}`).toBeCloseTo(viewport.height, 6);

        // Corners plus an off-centre interior point: enough to pin down an
        // affine map, and the corners are where sign errors show up.
        const probes: Array<[number, number]> = [
          [0, 0],
          [size.width, 0],
          [0, size.height],
          [size.width, size.height],
          [size.width * 0.3, size.height * 0.7],
        ];
        for (const [vx, vy] of probes) {
          const mine = visualToPdfPoint(box, vx, vy);
          const theirs = viewport.convertToPdfPoint(vx, vy);
          expect(mine.x, `x en (${vx},${vy}) ${label}`).toBeCloseTo(theirs[0], 6);
          expect(mine.y, `y en (${vx},${vy}) ${label}`).toBeCloseTo(theirs[1], 6);
        }

        // The y-up frame is the one the drawing code uses: bottom-left origin.
        const bottomLeft = visualUpToPdfPoint(box, 0, 0);
        const fromTop = visualToPdfPoint(box, 0, size.height);
        expect(bottomLeft.x, `y-up x ${label}`).toBeCloseTo(fromTop.x, 6);
        expect(bottomLeft.y, `y-up y ${label}`).toBeCloseTo(fromTop.y, 6);

        await task.destroy();
      }
    }
  });
});

describe('anchorBlock', () => {
  const visual = { width: 400, height: 600 };
  const content = { width: 100, height: 20 };

  it('puts each anchor where its name says, in the y-up frame', () => {
    expect(anchorBlock(visual, content, 'bottom-left', 36)).toEqual({ x: 36, y: 36 });
    expect(anchorBlock(visual, content, 'top-right', 36)).toEqual({ x: 264, y: 544 });
    expect(anchorBlock(visual, content, 'center', 36)).toEqual({ x: 150, y: 290 });
    expect(anchorBlock(visual, content, 'bottom-center', 36)).toEqual({ x: 150, y: 36 });
    expect(anchorBlock(visual, content, 'middle-left', 36)).toEqual({ x: 36, y: 290 });
  });

  it('clamps a block bigger than the page instead of pushing it off', () => {
    const huge = { width: 900, height: 900 };
    expect(anchorBlock(visual, huge, 'top-right', 36)).toEqual({ x: 0, y: 0 });
  });
});

describe('originForRotatedCenter', () => {
  it('is the identity offset at zero degrees', () => {
    const origin = originForRotatedCenter({ x: 200, y: 300 }, { width: 100, height: 20 }, 0);
    expect(origin.x).toBeCloseTo(150, 8);
    expect(origin.y).toBeCloseTo(290, 8);
  });

  it('keeps a tilted block centred on its target', () => {
    // Rotate the block's centre offset by the same angle and it must land back
    // on the target — this is the property the watermark depends on.
    for (const angle of [0, 30, 45, 90, 145, -45]) {
      const target = { x: 200, y: 300 };
      const content = { width: 180, height: 24 };
      const origin = originForRotatedCenter(target, content, angle);

      const radians = (angle * Math.PI) / 180;
      const cx =
        origin.x + (content.width / 2) * Math.cos(radians) - (content.height / 2) * Math.sin(radians);
      const cy =
        origin.y + (content.width / 2) * Math.sin(radians) + (content.height / 2) * Math.cos(radians);

      expect(cx, `centro x a ${angle}°`).toBeCloseTo(target.x, 8);
      expect(cy, `centro y a ${angle}°`).toBeCloseTo(target.y, 8);
    }
  });
});
