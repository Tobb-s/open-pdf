import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import {
  clientToCanvasPoint,
  pdfToViewportPoint,
  uprightTextRotation,
  viewportToPdfPoint,
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
