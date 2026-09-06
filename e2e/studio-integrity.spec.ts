import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFStream } from 'pdf-lib';

const PNG = Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

async function fixture(badMetadata = false) {
  const document = await PDFDocument.create();
  document.addPage([420, 594]).drawText('CONFIDENCIAL', { x: 50, y: 500 });
  if (badMetadata) {
    const stream = document.context.stream('unreadable', { Type: 'Metadata', Filter: 'UnsupportedFilter' });
    document.catalog.set(PDFName.of('Metadata'), document.context.register(stream));
  }
  return Buffer.from(await document.save());
}

async function open(page: Page, name: string) {
  await page.goto('/es/studio');
  await page.locator('#studio-file-input').setInputFiles({ name, mimeType: 'application/pdf', buffer: await fixture() });
  await expect(page.getByText('Guardado en este navegador', { exact: true })).toBeVisible();
  await expect(page.locator('canvas[style*="touch-action"]').locator('xpath=../..')).toHaveAttribute('aria-busy', 'false');
}

async function stored(page: Page) {
  return page.evaluate(() => new Promise<{ name: string; cursor: number; matching: boolean }>((resolve, reject) => {
    const opening = indexedDB.open('openpdf-studio', 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('session', 'readonly');
      const store = tx.objectStore('session');
      const original = store.get('original');
      const script = store.get('script');
      tx.oncomplete = () => {
        resolve({ name: original.result?.name, cursor: script.result?.cursor,
          matching: original.result?.sessionId === script.result?.sessionId });
        db.close();
      };
    };
  }));
}

async function restoreRaster(page: Page, bitmap: number[] | null, badMetadata = false) {
  await page.goto('/es/studio');
  await page.evaluate(({ original, bitmap }) => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open('openpdf-studio', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('session');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('session', 'readwrite');
      tx.objectStore('session').put({
        shape: 2, name: 'recovered.pdf', original: new Uint8Array(original),
        edits: [{ kind: 'raster', page: 'o0', raster: {
          asset: 'bitmap', boxes: [{ x: 0, y: 0, width: 420, height: 594 }], redactedWords: ['CONFIDENCIAL'],
        } }], cursor: 1, assets: bitmap ? { bitmap: new Uint8Array(bitmap) } : {}, savedAt: Date.now(),
      }, 'current');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { original: Array.from(await fixture(badMetadata)), bitmap });
  await page.reload();
  await page.getByRole('button', { name: 'Seguir donde estaba', exact: true }).click();
  await expect(page.getByText('1 edición', { exact: true })).toBeVisible();
}

test('an older tab cannot overwrite or erase another document backup', async ({ page, context }) => {
  await open(page, 'first.pdf');
  const second = await context.newPage();
  await open(second, 'second.pdf');
  await page.getByRole('button', { name: 'Girar a la derecha', exact: true }).click();
  await expect(page.getByText('No se pudo guardar en este navegador', { exact: true })).toBeVisible();
  expect(await stored(second)).toEqual({ name: 'second.pdf', cursor: 0, matching: true });
  await page.getByRole('button', { name: 'Quitar este archivo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'OpenPDF Studio' })).toBeVisible();
  expect(await stored(second)).toEqual({ name: 'second.pdf', cursor: 0, matching: true });
});

test('a restored edit survives an immediate second reload', async ({ page }) => {
  await open(page, 'resume.pdf');
  await page.getByRole('button', { name: 'Girar a la derecha', exact: true }).click();
  await expect.poll(async () => (await stored(page)).cursor).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Seguir donde estaba', exact: true }).click();
  await expect(page.getByText('1 edición', { exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).cursor).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Seguir donde estaba', exact: true }).click();
  await expect(page.getByText('1 edición', { exact: true })).toBeVisible();
});

for (const [label, bitmap, badMetadata] of [
  ['missing redaction image', null, false],
  ['invalid redaction image', [1, 2, 3], false],
  ['unreadable hidden metadata', PNG, true],
] as const) {
  test(`export refuses ${label} in a recovered session`, async ({ page }) => {
    await restoreRaster(page, bitmap ? [...bitmap] : null, badMetadata);
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    await expect(page.getByText('No se puede verificar esta exportación', { exact: true })).toBeVisible({ timeout: 30_000 });
    if (badMetadata) {
      await expect(page.locator('canvas[style*="touch-action"]').locator('xpath=../..')).toHaveAttribute('aria-busy', 'false');
      await expect(page.getByText('No se puede verificar esta exportación', { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Descargar', exact: true })).toHaveCount(0);
  });
}

test('a valid recovered redaction downloads a PDF without the original text', async ({ page }) => {
  await restoreRaster(page, PNG);
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar', exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  const document = await PDFDocument.load(bytes);
  expect(document.getPageCount()).toBe(1);
  expect(document.context.enumerateIndirectObjects().some(([, value]) =>
    value instanceof PDFStream && value.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))).toBe(true);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  try {
    const opened = await task.promise;
    expect((await (await opened.getPage(1)).getTextContent()).items).toHaveLength(0);
  } finally { await task.destroy(); }
});
