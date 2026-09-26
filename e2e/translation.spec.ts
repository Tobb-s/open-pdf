import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
test.setTimeout(180_000);
async function native(page: Page, count = 1, rotated = false) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < count; i++) {
    const p = doc.addPage([400, 400]);
    p.drawText('Economic growth depends on investment.', { x: 35, y: 340, size: 12, font });
    p.drawRectangle({ x: 100, y: 100, width: 100, height: 70, color: rgb(0, 0.4, 0.9) });
    if (rotated) p.setRotation(degrees(90));
  }
  await page.locator('#translate-file-input').setInputFiles({ name: 'translation-fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await page.getByRole('button', { name: 'Analizar PDF localmente' }).click();
  await expect(page.getByText('Revisión por bloques')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analizar PDF localmente' })).toBeEnabled({ timeout: 90_000 });
}
async function credentials(page: Page) {
  await page.getByLabel('Clave API (sólo en memoria)').fill('synthetic-test-key-not-real');
  await page.getByLabel(/Autorizo enviar/).check();
}
async function fakeProvider(page: Page) {
  await page.route('**/api/translate', route => {
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { translations: body.segments.map((s: { id: string }) => ({ id: s.id, text: 'La inversión impulsa el crecimiento.' })) } });
  });
}
test('native PDF, consent, reviewed translation, real export and retained illustration', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/es/translate'); await native(page);
  await expect(page.getByRole('button', { name: 'Traducir pendientes' })).toBeDisabled();
  await credentials(page); await fakeProvider(page);
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect(page.getByLabel('Español argentino p1_b1')).toHaveValue('La inversión impulsa el crecimiento.');
  await page.getByRole('button', { name: 'Generar vista previa del PDF' }).click();
  const downloadButton = page.getByRole('button', { name: 'Descargar PDF traducido' });
  await expect(downloadButton).toBeVisible({ timeout: 30_000 });
  const download = page.waitForEvent('download'); await downloadButton.click();
  const saved = await download; const file = testInfo.outputPath('translated.pdf'); await saved.saveAs(file);
  const bytes = await readFile(file), doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1); expect(doc.getPage(0).getSize()).toEqual({ width: 400, height: 400 });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await loading.promise;
  try {
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map(i => 'str' in i ? i.str : '').join(' ');
    expect(text).toContain('inversión'); expect(text).not.toContain('Economic');
  } finally { await loading.destroy(); }
  const canvas = page.getByLabel('Resultado generado', { exact: true });
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(400);
  const pixel = await canvas.evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(c.width * .375, c.height * .675, 1, 1).data]);
  expect(pixel[2]).toBeGreaterThan(200); expect(pixel[0]).toBeLessThan(20);
  await canvas.screenshot({ path: testInfo.outputPath('translated-preview.png') });
  expect(errors).toEqual([]);
  await page.getByLabel('Español argentino p1_b1').fill('Otra revisión.');
  await expect(downloadButton).not.toBeVisible();
});
test('bad provider response keeps original and permits retry', async ({ page }) => {
  await page.goto('/es/translate'); await native(page); await credentials(page);
  await page.route('**/api/translate', r => r.fulfill({ json: { translations: [] } }));
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'incompleta o inválida' })).toBeVisible();
  await expect(page.getByLabel('Español argentino p1_b1')).toHaveValue('');
  await page.unroute('**/api/translate'); await fakeProvider(page);
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect(page.getByLabel('Español argentino p1_b1')).not.toHaveValue('');
});
test('overflow and unsupported glyphs cannot produce a clipped PDF', async ({ page }) => {
  await page.goto('/es/translate'); await native(page);
  await page.getByLabel('Español argentino p1_b1').fill('Texto '.repeat(200));
  await page.getByRole('button', { name: 'Generar vista previa del PDF' }).click();
  await expect(page.getByText(/El texto no entra sin bajar/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar PDF traducido' })).not.toBeVisible();
  await page.getByLabel('Español argentino p1_b1').fill('Texto 漢');
  await page.getByRole('button', { name: 'Generar vista previa del PDF' }).click();
  await expect(page.getByText(/Hay caracteres que la fuente/)).toBeVisible();
});
test('credentials are not persisted; changing provider clears the key and consent', async ({ page }) => {
  await page.goto('/es/translate'); await credentials(page);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('synthetic-test-key');
  await page.getByRole('combobox', { name: 'Proveedor', exact: true }).selectOption('gemini');
  await expect(page.getByLabel('Clave API (sólo en memoria)')).toHaveValue('');
  await expect(page.getByLabel(/Autorizo enviar/)).not.toBeChecked();
  await credentials(page); await page.reload();
  await expect(page.getByLabel('Clave API (sólo en memoria)')).toHaveValue('');
});
test('source edits invalidate only that translation and reset generated output', async ({ page }) => {
  await page.goto('/es/translate'); await native(page, 2); await credentials(page); await fakeProvider(page);
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect(page.getByRole('status')).toHaveText('0 bloques pendientes');
  await page.getByLabel('Texto original / OCR p1_b1').fill('Corrected source sentence.');
  await expect(page.getByRole('status')).toHaveText('1 bloques pendientes');
  await page.getByLabel('Página', { exact: true }).selectOption('1');
  await expect(page.getByLabel('Español argentino p2_b1')).not.toHaveValue('');
});
test('cancellation does not lock the UI', async ({ page }) => {
  await page.goto('/es/translate'); await native(page); await credentials(page);
  let called = false;
  await page.route('**/api/translate', async r => { called = true; await new Promise(resolve => setTimeout(resolve, 2000)); await r.abort().catch(() => {}); });
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect.poll(() => called).toBe(true);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Traducir pendientes' })).toBeEnabled();
  await expect(page.getByLabel('Español argentino p1_b1')).toHaveValue('');
});
test('rotated unsupported text is explicitly reported, not overlaid wrongly', async ({ page }) => {
  await page.goto('/es/translate'); await native(page, 1, true);
  await expect(page.getByText(/Texto girado no traducido/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Traducir pendientes' })).toBeDisabled();
});
test('English UI and route catalog include translation', async ({ page }) => {
  await page.goto('/en/translate'); await expect(page.getByRole('heading', { name: 'Translate PDF' })).toBeVisible();
  await expect(page.getByLabel('API key (memory only)')).toBeVisible();
  await page.goto('/es'); await page.getByRole('searchbox').fill('traducir');
  await expect(page.getByRole('link', { name: /Traducir PDF/ })).toBeVisible();
});
test('English scan uses deep local OCR before translation', async ({ page }) => {
  await page.goto('/es/translate');
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 600;
    const x = c.getContext('2d')!; x.fillStyle = 'white'; x.fillRect(0, 0, 1200, 600); x.fillStyle = 'black';
    x.font = '32px Arial'; x.fillText('Economic growth depends on investment.', 60, 100);
    x.fillText('Capital and education improve productivity.', 60, 160);
    return c.toDataURL('image/png').split(',')[1];
  });
  const doc = await PDFDocument.create(), image = await doc.embedPng(Buffer.from(png, 'base64'));
  doc.addPage([600, 300]).drawImage(image, { x: 0, y: 0, width: 600, height: 300 });
  await page.locator('#translate-file-input').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await page.getByRole('button', { name: 'Analizar PDF localmente' }).click();
  await expect(page.getByText('Revisión por bloques')).toBeVisible({ timeout: 150_000 });
  await expect(page.getByLabel('Página', { exact: true })).toContainText('OCR');
  await expect(page.getByLabel('Texto original / OCR p1_b1')).toHaveValue(/Economic growth/i);
  const sources = page.locator('textarea[aria-label^="Texto original / OCR"]');
  // Nearby complete lines may form a paragraph; verify content, not block count.
  await expect.poll(async () => sources.evaluateAll(nodes => nodes.map(node =>
    (node as HTMLTextAreaElement).value).join(' ').replace(/\s+/g, ' ').trim()))
    .toBe('Economic growth depends on investment. Capital and education improve productivity.');
});
