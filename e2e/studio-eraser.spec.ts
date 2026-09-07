import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';

test.setTimeout(60_000);
const canvas = (page: Page) => page.locator('canvas[style*="touch-action"]').first();
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function ready(page: Page) {
  await expect(canvas(page)).toBeVisible();
  await expect(canvas(page).locator('xpath=../..')).toHaveAttribute('aria-busy', 'false');
}
async function edits(page: Page, count: number) {
  await expect(page.getByText(count === 1 ? '1 edición' : `${count} ediciones`, { exact: true })).toBeVisible();
  await ready(page);
}
async function saved(page: Page, cursor: number) {
  // Autosave is debounced: the previous "saved" label can still be visible
  // briefly after an edit. Wait for the actual persisted revision before reload.
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const opening = indexedDB.open('openpdf-studio', 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('session', 'readonly');
      const request = tx.objectStore('session').get('script');
      tx.oncomplete = () => { resolve(request.result?.cursor ?? -1); db.close(); };
      tx.onabort = () => { reject(tx.error); db.close(); };
    };
  }))).toBe(cursor);
}
async function open(page: Page, duplicate = false) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Eraser regression');
  const first = pdf.addPage([300, 400]);
  first.drawText('BORRAR', { x: 50, y: 300, size: 18 });
  first.drawText(duplicate ? 'BORRAR' : 'CONSERVAR', { x: 50, y: 70, size: 18 });
  pdf.addPage([300, 400]).drawText(duplicate ? 'BORRAR' : 'INTACTA', { x: 50, y: 300, size: 18 });
  await page.goto('/es/studio');
  await page.locator('#studio-file-input').setInputFiles({
    name: 'eraser.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
  });
  await ready(page);
}
async function paint(page: Page, tool: string, rect: number[], count: number) {
  await button(page, tool).click();
  await ready(page);
  await canvas(page).scrollIntoViewIfNeeded();
  const b = (await canvas(page).boundingBox())!;
  // Normalized visual coordinates, independent of zoom and device pixel ratio.
  await page.mouse.move(b.x + rect[0] * b.width, b.y + rect[1] * b.height);
  await page.mouse.down();
  await page.mouse.move(b.x + rect[2] * b.width, b.y + rect[3] * b.height, { steps: 10 });
  await page.mouse.up();
  await edits(page, count);
}
async function addText(page: Page, text: string, y: number, count: number) {
  await button(page, 'Texto').click();
  await page.getByPlaceholder('Escribí acá…').fill(text);
  const b = (await canvas(page).boundingBox())!;
  await canvas(page).click({ position: { x: b.width * .15, y: b.height * y } });
  await edits(page, count);
}
async function whiteFraction(page: Page, rect: number[]) {
  return canvas(page).evaluate((element, r) => {
    const c = element as HTMLCanvasElement;
    const data = c.getContext('2d')!.getImageData(
      Math.ceil(r[0] * c.width), Math.ceil(r[1] * c.height),
      Math.floor((r[2] - r[0]) * c.width), Math.floor((r[3] - r[1]) * c.height),
    ).data;
    let white = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) white++;
    return white / (data.length / 4);
  }, rect);
}
async function download(page: Page) {
  await button(page, 'Exportar').click();
  const pending = page.waitForEvent('download');
  await button(page, 'Descargar').click();
  const file = await pending;
  expect(await file.failure()).toBeNull();
  const bytes = await readFile((await file.path())!);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getTitle()).toBe('Eraser regression');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes),
    standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/',
  });
  try {
    const document = await task.promise;
    const texts = [];
    for (let n = 1; n <= document.numPages; n++) {
      const p = await document.getPage(n);
      texts.push((await p.getTextContent()).items.flatMap(i => 'str' in i ? [i.str] : []).join(' '));
    }
    return texts;
  } finally { await task.destroy(); }
}
const firstWord = [.13, .17, .58, .29];
const addedArea = [.1, .4, .9, .6];

test('local erasure allows duplicates on the same page and another page', async ({ page }) => {
  await open(page, true);
  await paint(page, 'Goma', firstWord, 1);
  expect(await whiteFraction(page, [.15, .19, .55, .27])).toBe(1);
  expect(await whiteFraction(page, [.15, .77, .55, .84])).toBeLessThan(.99);
  expect(await download(page)).toEqual(['', 'BORRAR']);
});

test('added text stays erased after a second stroke, undo, redo and reload', async ({ page }) => {
  await open(page);
  await addText(page, 'MARCA NUEVA', .53, 1);
  const original = await canvas(page).evaluate(c => (c as HTMLCanvasElement).toDataURL());
  await paint(page, 'Goma', addedArea, 2);
  expect(await whiteFraction(page, [.12, .42, .88, .58])).toBe(1);
  await button(page, 'Deshacer').click(); await edits(page, 1);
  expect(await canvas(page).evaluate(c => (c as HTMLCanvasElement).toDataURL())).toBe(original);
  await button(page, 'Rehacer').click(); await edits(page, 2);
  await paint(page, 'Goma', firstWord, 3);
  expect(await whiteFraction(page, [.12, .42, .88, .58])).toBe(1);
  await saved(page, 3);
  await page.reload();
  await button(page, 'Seguir donde estaba').click(); await edits(page, 3);
  expect(await whiteFraction(page, [.12, .42, .88, .58])).toBe(1);
  expect(await download(page)).toEqual(['', 'INTACTA']);
});

test('an added mark outside the selection survives consecutive erasures', async ({ page }) => {
  await open(page);
  await addText(page, 'CONSERVAR MARCA', .53, 1);
  await paint(page, 'Goma', firstWord, 2);
  expect(await whiteFraction(page, [.12, .42, .88, .58])).toBeLessThan(.999);
  await paint(page, 'Goma', [.13, .75, .7, .86], 3);
  expect(await whiteFraction(page, [.12, .42, .88, .58])).toBeLessThan(.999);
  expect(await download(page)).toEqual(['', 'INTACTA']);
});

for (const laterErase of [false, true]) {
  test(`strict redaction still blocks a duplicate${laterErase ? ' after a later erasure' : ''}`, async ({ page }) => {
    await open(page, true);
    await paint(page, 'Tachar', firstWord, 1);
    if (laterErase) await paint(page, 'Goma', addedArea, 2);
    await button(page, 'Exportar').click();
    await expect(page.getByText('No se entregó el archivo', { exact: true })).toBeVisible();
    await expect(button(page, 'Descargar')).toHaveCount(0);
  });
}

test('redacting added text remembers its target after baking and erasing again', async ({ page }) => {
  await open(page, true);
  await addText(page, 'BORRAR', .53, 1);
  await paint(page, 'Tachar', addedArea, 2);
  await paint(page, 'Goma', firstWord, 3);
  await button(page, 'Exportar').click();
  await expect(page.getByText('No se entregó el archivo', { exact: true })).toBeVisible();
  await expect(button(page, 'Descargar')).toHaveCount(0);
});

for (const initialTool of ['Goma', 'Tachar']) {
  test(`a later redaction checks text baked by ${initialTool}, even after reload`, async ({ page }) => {
    await open(page);
    await addText(page, 'INTACTA', .53, 1);
    await paint(page, initialTool, firstWord, 2);
    await saved(page, 2);
    await page.reload();
    await button(page, 'Seguir donde estaba').click(); await edits(page, 2);
    await paint(page, 'Tachar', addedArea, 3);
    await button(page, 'Exportar').click();
    await expect(page.getByText('No se entregó el archivo', { exact: true })).toBeVisible();
    await expect(page.getByText(/Todavía se puede encontrar.*«INTACTA»/)).toBeVisible();
    await expect(button(page, 'Descargar')).toHaveCount(0);
  });
}
