import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDocument, PDFName, PDFStream } from 'pdf-lib';

// Varied scenarios with stable inputs: a failing run must be reproducible.
test.setTimeout(60_000);
const canvas = (page: Page) => page.locator('canvas[style*="touch-action"]').first();
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function ready(page: Page) {
  await expect(canvas(page)).toBeVisible();
  await expect(canvas(page).locator('xpath=../..')).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
}

async function open(page: Page, pages = 1) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Original title');
  for (let i = 1; i <= pages; i++) {
    pdf.addPage([420, 594]).drawText(`Original page ${i}`, { x: 48, y: 510, size: 18 });
  }
  await page.goto('/es/studio');
  await page.locator('#studio-file-input').setInputFiles({
    name: 'tool-output-audit.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
  });
  await ready(page);
}

async function edits(page: Page, count: number) {
  await expect(page.getByText(count === 1 ? '1 edición' : `${count} ediciones`, { exact: true })).toBeVisible();
  await ready(page);
}

async function point(page: Page, x: number, y: number) {
  await ready(page);
  await canvas(page).scrollIntoViewIfNeeded();
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('Missing canvas');
  await canvas(page).click({ position: { x: x * box.width, y: y * box.height } });
}

async function download(page: Page) {
  await button(page, 'Exportar').click();
  const pending = page.waitForEvent('download');
  await button(page, 'Descargar').click();
  const result = await pending;
  expect(await result.failure()).toBeNull();
  const bytes = await readFile((await result.path())!);
  const pdf = await PDFDocument.load(bytes);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/',
  });
  const texts: string[][] = [];
  const notes: string[] = [];
  try {
    const parsed = await task.promise;
    for (let i = 1; i <= parsed.numPages; i++) {
      const current = await parsed.getPage(i);
      texts.push((await current.getTextContent()).items.flatMap(item => 'str' in item ? [item.str] : []));
      for (const annotation of await current.getAnnotations()) {
        if (annotation.contentsObj?.str) notes.push(annotation.contentsObj.str);
      }
    }
  } finally { await task.destroy(); }
  return { pdf, texts, notes };
}

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const found: string[] = [];
  errors.set(page, found);
  page.on('pageerror', error => found.push(error.message));
  page.on('console', message => { if (message.type() === 'error') found.push(message.text()); });
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

test('01 accented text survives placement, undo, redo and PDF extraction', async ({ page }) => {
  await open(page);
  await button(page, 'Texto').click();
  await page.getByPlaceholder('Escribí acá…').fill('Revisión: año 2026, acción y café');
  await point(page, 0.23, 0.43);
  await edits(page, 1);
  await button(page, 'Deshacer').click();
  await expect(page.getByText('Sin cambios', { exact: true })).toBeVisible();
  await button(page, 'Rehacer').click();
  await edits(page, 1);
  const result = await download(page);
  expect(result.texts[0].join(' ')).toContain('Revisión: año 2026, acción y café');
  expect(result.texts[0].join(' ')).toContain('Original page 1');
});

test('02 replacement changes extracted text and removes the old text', async ({ page }) => {
  await open(page);
  await button(page, 'Reemplazar').click();
  await button(page, 'Original page 1').click();
  await page.locator('aside textarea').first().fill('Updated line');
  await button(page, 'Aplicar reemplazo').click();
  await edits(page, 1);
  const result = await download(page);
  expect(result.texts[0].join(' ')).toContain('Updated line');
  expect(result.texts[0].join(' ')).not.toContain('Original page 1');
});

test('03 crop exports the selected geometry without changing the media size', async ({ page }) => {
  await open(page);
  await button(page, 'Recortar').click();
  await ready(page);
  await canvas(page).scrollIntoViewIfNeeded();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.8, { steps: 10 });
  await page.mouse.up();
  await edits(page, 1);
  const result = await download(page);
  const crop = result.pdf.getPage(0).getCropBox();
  expect(result.pdf.getPage(0).getSize()).toEqual({ width: 420, height: 594 });
  expect(Math.abs(crop.width - 294)).toBeLessThan(3);
  expect(Math.abs(crop.height - 356.4)).toBeLessThan(3);
  expect(Math.abs(crop.x - 63)).toBeLessThan(3);
  expect(Math.abs(crop.y - 118.8)).toBeLessThan(3);
});

test('04 rotating only the second page preserves all three page texts', async ({ page }) => {
  await open(page, 3);
  await button(page, 'Girar a la derecha').nth(1).click();
  await edits(page, 1);
  const result = await download(page);
  expect(result.pdf.getPages().map(p => p.getRotation().angle)).toEqual([0, 90, 0]);
  expect(result.texts.map(t => t.join(' '))).toEqual(['Original page 1', 'Original page 2', 'Original page 3']);
});

test('05 reorder and delete use the visible page order, with reversible deletion', async ({ page }) => {
  await open(page, 3);
  await button(page, 'Mover antes').nth(2).click();
  await edits(page, 1);
  await button(page, 'Eliminar página').first().click();
  await edits(page, 2);
  await button(page, 'Deshacer').click();
  await edits(page, 1);
  await button(page, 'Rehacer').click();
  await edits(page, 2);
  const result = await download(page);
  expect(result.pdf.getPageCount()).toBe(2);
  expect(result.texts.map(t => t.join(' '))).toEqual(['Original page 3', 'Original page 2']);
});

test('06 title and author preserve accents in the downloaded metadata', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Documento', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Auditoría económica — 2026');
  await page.getByLabel('Autor', { exact: true }).fill('María Núñez');
  await edits(page, 2);
  const result = await download(page);
  expect(result.pdf.getTitle()).toBe('Auditoría económica — 2026');
  expect(result.pdf.getAuthor()).toBe('María Núñez');
});

test('07 watermark is present on each downloaded page', async ({ page }) => {
  await open(page, 3);
  await page.getByRole('tab', { name: 'Documento', exact: true }).click();
  await page.getByLabel('Texto', { exact: true }).fill('AUDIT DRAFT');
  await edits(page, 1);
  const result = await download(page);
  for (let i = 0; i < 3; i++) {
    expect(result.texts[i].join(' ')).toContain('AUDIT DRAFT');
    expect(result.texts[i].join(' ')).toContain(`Original page ${i + 1}`);
  }
});

test('08 numbering follows the final page order after reordering', async ({ page }) => {
  await open(page, 3);
  await page.getByRole('tab', { name: 'Documento', exact: true }).click();
  await button(page, 'Solo el número').click();
  await edits(page, 1);
  await button(page, 'Mover antes').nth(2).click();
  await edits(page, 2);
  const result = await download(page);
  for (const [index, original] of [1, 3, 2].entries()) {
    expect(result.texts[index]).toContain(`Original page ${original}`);
    expect(result.texts[index]).toContain(String(index + 1));
  }
});

test('09 comment and reply survive as PDF annotation content', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await button(page, 'Nota').click();
  await page.getByPlaceholder('Escribí el comentario…').fill('Revisar total de ventas');
  await point(page, 0.68, 0.37);
  await edits(page, 1);
  await page.getByPlaceholder('Responder…').fill('Total confirmado: 1250');
  await button(page, 'Responder').click();
  await edits(page, 2);
  const result = await download(page);
  expect(result.notes.join('\n')).toContain('Revisar total de ventas');
  expect(result.notes.join('\n')).toContain('Total confirmado: 1250');
});

test('10 typed signature exports an image appearance without removing original text', async ({ page }) => {
  await open(page);
  await button(page, 'Firmar').click();
  await page.getByLabel('Nombre del firmante').fill('María Auditora');
  await button(page, 'Preparar firma').click();
  await expect(page.getByText(/Firma lista:/)).toBeVisible();
  await point(page, 0.57, 0.73);
  await edits(page, 1);
  const result = await download(page);
  expect(result.texts[0]).toContain('Original page 1');
  expect(result.pdf.context.enumerateIndirectObjects().some(([, value]) =>
    value instanceof PDFStream && value.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))).toBe(true);
});
