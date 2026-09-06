import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

test.setTimeout(180_000);
async function scan(page: Page, turn = 90) {
  const data = await page.evaluate((degrees) => {
    const original = document.createElement('canvas');
    original.width = 1200;
    original.height = 800;
    const ctx = original.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = '#333';
    ctx.font = '36px monospace';
    [
      'ROBUSTEZ OCR 12345',
      'Texto impreso para verificar lectura.',
      'Orientacion correcta sin girar el PDF.',
      'Nombres y cifras requieren revision.',
      'Segunda pasada de contraste local.',
      'Documento de prueba sin datos privados.',
    ].forEach((text, i) => ctx.fillText(text, 65, 100 + i * 85));
    const rotated = document.createElement('canvas');
    const swap = degrees === 90 || degrees === 270;
    rotated.width = swap ? 800 : 1200;
    rotated.height = swap ? 1200 : 800;
    const target = rotated.getContext('2d')!;
    target.translate(rotated.width / 2, rotated.height / 2);
    target.rotate((degrees * Math.PI) / 180);
    target.drawImage(original, -600, -400);
    return {
      image: rotated.toDataURL('image/png').split(',')[1],
      width: rotated.width / 2,
      height: rotated.height / 2,
    };
  }, turn);
  const doc = await PDFDocument.create();
  doc.setTitle('OCR preservation fixture');
  const image = await doc.embedPng(Buffer.from(data.image, 'base64'));
  doc
    .addPage([data.width, data.height])
    .drawImage(image, { x: 0, y: 0, width: data.width, height: data.height });
  return doc;
}

async function downloaded(page: Page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: /PDF buscable/ }).click();
  const path = await (await event).path();
  if (!path) throw Error('No download');
  return readFile(path);
}

test('local OCR rotates a scan, preserves native pages/forms and exports corrections', async ({
  page,
}) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => {
    if (
      new URL(route.request().url()).hostname !==
      new URL(page.url() === 'about:blank' ? 'http://127.0.0.1:3000' : page.url()).hostname
    )
      external.push(route.request().url());
    return route.continue();
  });
  await page.goto('/es/ocr');
  const doc = await scan(page);
  const native = doc.addPage([400, 600]);
  native.drawText('NATIVE TEXT MUST STAY', {
    x: 40,
    y: 520,
    size: 16,
    font: await doc.embedFont(StandardFonts.Helvetica),
  });
  const field = doc.getForm().createTextField('preserved');
  field.setText('VALUE');
  field.addToPage(native, { x: 40, y: 450, width: 180, height: 25 });
  const input = await doc.save();
  await page
    .locator('#ocr-file-input')
    .setInputFiles({
      name: 'synthetic-scan.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(input),
    });
  await page.getByRole('button', { name: 'Empezar el OCR', exact: true }).click();
  await expect(page.getByText('Revisar reconocimiento', { exact: true })).toBeVisible({
    timeout: 150_000,
  });
  await expect(page.locator('pre')).toContainText('ROBUSTEZ OCR 12345');
  await expect(page.locator('pre')).toContainText('NATIVE TEXT MUST STAY');
  await expect(page.getByText(/270° ·/)).toBeVisible();
  await page.getByLabel('Sólo palabras dudosas (<60)').uncheck();
  await page.getByRole('button', { name: /^ROBUSTEZ / }).click();
  await page.getByLabel('Corregir palabra OCR (no modifica la imagen)').fill('CORREGIDO');
  await page.getByRole('button', { name: 'Releer este recorte ampliado' }).click();
  await expect(page.getByText('Alternativa:', { exact: false })).toContainText('ROBUSTEZ', {
    timeout: 60_000,
  });
  // Rereading proposes an alternative, without silently replacing the user's correction.
  await expect(page.getByLabel('Corregir palabra OCR (no modifica la imagen)')).toHaveValue(
    'CORREGIDO'
  );
  await expect(page.locator('pre')).toContainText('CORREGIDO OCR 12345');
  const bytes = await downloaded(page);
  const output = await PDFDocument.load(bytes);
  expect(output.getTitle()).toBe('OCR preservation fixture');
  expect(output.getPageCount()).toBe(2);
  expect(output.getForm().getTextField('preserved').getText()).toBe('VALUE');
  expect(output.getPage(0).getSize()).toEqual(doc.getPage(0).getSize());
  expect(output.getPage(0).getRotation().angle).toBe(0);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const parsed = await task.promise;
  try {
    const content = await (await parsed.getPage(1)).getTextContent();
    expect(
      content.items
        .filter((item) => 'str' in item)
        .map((item) => item.str)
        .join(' ')
    ).toContain('CORREGIDO');
    const word = content.items.find((item) => 'str' in item && item.str === 'CORREGIDO');
    expect(word && 'transform' in word ? Math.abs(word.transform[1]) : 0).toBeGreaterThan(1);
    const second = await (await parsed.getPage(2)).getTextContent();
    expect(
      second.items.filter((item) => 'str' in item && item.str.includes('NATIVE TEXT MUST STAY'))
    ).toHaveLength(1);
  } finally {
    await task.destroy();
  }
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('cancellation interrupts active recognition and allows retry', async ({ page }) => {
  await page.goto('/es/ocr');
  const doc = await scan(page, 0);
  await page
    .locator('#ocr-file-input')
    .setInputFiles({
      name: 'cancel.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
  await page.getByRole('button', { name: 'Empezar el OCR', exact: true }).click();
  await expect(page.getByText(/↻ 0°/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Cancelar/ })).toBeVisible();
  await page.getByRole('button', { name: /Cancelar/ }).click();
  await expect(page.getByRole('button', { name: 'Empezar el OCR', exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  await page.getByLabel('Giro para leer (no gira el PDF)').selectOption('0');
  await page.getByLabel('Calidad de lectura').selectOption('quick');
  await page.getByRole('button', { name: 'Empezar el OCR', exact: true }).click();
  await expect(page.locator('pre')).toContainText('ROBUSTEZ OCR 12345', { timeout: 90_000 });
});

for (const turn of [0, 180, 270])
  test(`automatic orientation reads a ${turn} degree scan`, async ({ page }) => {
    await page.goto('/es/ocr');
    const doc = await scan(page, turn);
    await page
      .locator('#ocr-file-input')
      .setInputFiles({
        name: 'orientation.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await doc.save()),
      });
    await page.getByRole('button', { name: 'Empezar el OCR', exact: true }).click();
    await expect(page.locator('pre')).toContainText('ROBUSTEZ OCR 12345', { timeout: 120_000 });
    const expected = (360 - turn) % 360;
    await expect(page.getByText(new RegExp(`${expected}° ·`))).toBeVisible();
  });

test('a small native scan watermark does not prevent OCR or get duplicated', async ({ page }) => {
  await page.goto('/es/ocr');
  const doc = await scan(page, 0);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.getPage(0).drawText('Scan watermark', { x: 350, y: 12, size: 9, font });
  await page
    .locator('#ocr-file-input')
    .setInputFiles({
      name: 'mixed-scan.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
  await page.getByRole('button', { name: 'Empezar el OCR', exact: true }).click();
  await expect(page.locator('pre')).toContainText('ROBUSTEZ OCR 12345', { timeout: 120_000 });
  const bytes = await downloaded(page);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const text = await (await (await task.promise).getPage(1)).getTextContent();
    expect(
      text.items
        .filter((item) => 'str' in item)
        .map((item) => item.str)
        .join(' ')
        .match(/Scan watermark/g)
    ).toHaveLength(1);
  } finally {
    await task.destroy();
  }
});

test('Studio OCR stays invisible, replaces its own layer and survives undo and reload', async ({
  page,
}) => {
  await page.goto('/es/studio');
  const doc = await scan(page);
  await page
    .locator('#studio-file-input')
    .setInputFiles({
      name: 'studio-ocr.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
  const canvas = page.locator('canvas[style*="touch-action"]').first();
  const ready = async () => {
    await expect(canvas).toBeVisible();
    await expect(canvas.locator('xpath=../..')).toHaveAttribute('aria-busy', 'false', {
      timeout: 30_000,
    });
  };
  await ready();
  const before = await canvas.evaluate((image) => (image as HTMLCanvasElement).toDataURL());
  await page.getByRole('tab', { name: 'Documento', exact: true }).click();
  await page
    .getByRole('button', { name: 'Reconocer el texto de esta página', exact: true })
    .click();
  await expect(page.getByText('1 edición', { exact: true })).toBeVisible({ timeout: 120_000 });
  await ready();
  expect(await canvas.evaluate((image) => (image as HTMLCanvasElement).toDataURL())).toBe(before);
  await page.getByLabel('Sólo palabras dudosas (<60)').uncheck();
  await page.getByRole('button', { name: /^ROBUSTEZ / }).click();
  await page.getByLabel('Corregir palabra OCR (no modifica la imagen)').fill('ESTUDIO');
  await page.getByRole('button', { name: 'Aplicar correcciones OCR', exact: true }).click();
  await expect(page.getByText('2 ediciones', { exact: true })).toBeVisible();
  await ready();
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  await expect(page.getByText('1 edición', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rehacer', exact: true }).click();
  await expect(page.getByText('2 ediciones', { exact: true })).toBeVisible();
  // Let the existing session persistence debounce finish.
  await page.waitForTimeout(1200);
  await page.reload();
  await page.getByRole('button', { name: /Seguir donde/ }).click();
  await ready();
  await expect(page.getByText('2 ediciones', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Documento', exact: true }).click();
  await page
    .getByRole('button', { name: 'Reconocer el texto de esta página', exact: true })
    .click();
  await expect(page.getByText('3 ediciones', { exact: true })).toBeVisible({ timeout: 120_000 });
  await ready();
  expect(await canvas.evaluate((image) => (image as HTMLCanvasElement).toDataURL())).toBe(before);
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect(page.getByRole('heading', { name: /página exportada/ })).toBeVisible({
    timeout: 30_000,
  });
});
