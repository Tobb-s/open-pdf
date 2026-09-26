import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';

test.setTimeout(90_000);
async function fixture(page: Page, count = 1) {
  await page.route('**/api/account', route => route.fulfill({ json: { available: true, providers: [] } }));
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < count; i++) doc.addPage([400, 400]).drawText('Economic growth depends on investment.', { x: 35, y: 340, size: 12, font });
  await page.goto('/es/translate');
  await page.locator('#translate-file-input').setInputFiles({ name: 'ai-review-fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await page.getByRole('button', { name: 'Analizar PDF localmente', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Analizar PDF localmente', exact: true })).toBeEnabled();
}
async function source(page: Page, n: number, text: string) {
  await page.getByLabel('Página', { exact: true }).selectOption(String(n - 1));
  await page.getByLabel(`Texto original / OCR p${n}_b1`, { exact: true }).fill(text);
}
const reviewButton = (page: Page) => page.getByRole('button', { name: 'Revisar bloques dudosos con IA', exact: true });
async function authorize(page: Page) {
  await page.getByLabel('Clave API (sólo en memoria)', { exact: true }).fill('synthetic-test-key-not-real');
  await page.getByLabel(/^Autorizo la revisión visual por lote/).check();
}
test('one batch applies safe AI readings, retains number changes, skips excluded/translated blocks and permits export without manual confirmation', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await fixture(page, 4);
  await source(page, 1, 'Economic [illegible] depends on investment.');
  await source(page, 2, 'Growth in 1983 [illegible].');
  await source(page, 3, 'Excluded [illegible].');
  await page.getByLabel('p3_b1 · Traducir este bloque', { exact: true }).uncheck();
  await source(page, 4, 'Already translated [illegible].');
  await page.getByLabel('Español argentino p4_b1', { exact: true }).fill('Mi traducción conservada.');
  const calls: Record<string, unknown>[] = [];
  await page.route('**/api/translation-review', async route => {
    const body = route.request().postDataJSON(); calls.push(body);
    expect(route.request().headers().authorization).toBe('Bearer synthetic-test-key-not-real');
    expect(Object.keys(body).sort()).toEqual(['consent', 'image', 'model', 'sourceText']);
    expect(body.image).toMatch(/^data:image\/png;base64,/); expect(body.consent).toBe(true);
    if (calls.length === 1) await writeFile(testInfo.outputPath('synthetic-review-crop.png'), Buffer.from(body.image.slice(22), 'base64'));
    await route.fulfill({ json: { text: body.sourceText.startsWith('Growth') ? 'Growth in 1985.' : 'Economic growth depends on investment.', uncertain: false } });
  });
  await expect(reviewButton(page)).toBeDisabled(); expect(calls).toHaveLength(0);
  await authorize(page); await reviewButton(page).click();
  await expect(page.getByText('0 bloques dudosos sin revisar', { exact: true })).toBeVisible(); expect(calls).toHaveLength(2);
  await page.getByLabel('Página', { exact: true }).selectOption('0');
  await expect(page.getByLabel('Texto original / OCR p1_b1')).toHaveValue('Economic growth depends on investment.');
  await expect(page.getByText(/Lectura aplicada por IA ·/)).toBeVisible();
  await page.getByLabel('Página', { exact: true }).selectOption('1');
  await expect(page.getByLabel('Texto original / OCR p2_b1')).toHaveValue('Growth in 1983 [illegible].');
  await expect(page.getByText(/IA sin resolver: se conserva el original ·/)).toBeVisible();
  await expect(reviewButton(page)).toBeDisabled(); expect(calls).toHaveLength(2);
  await page.getByLabel('Página', { exact: true }).selectOption('3');
  await expect(page.getByLabel('Español argentino p4_b1')).toHaveValue('Mi traducción conservada.');
  const translations: Record<string, unknown>[] = [];
  await page.route('**/api/translate', route => {
    const body = route.request().postDataJSON(); translations.push(body);
    return route.fulfill({ json: { translations: body.segments.map((s: { id: string }) => ({ id: s.id, text: 'El crecimiento depende de la inversión.' })) } });
  });
  await page.getByLabel(/^Autorizo enviar los textos incluidos/).check();
  await page.getByRole('button', { name: 'Traducir pendientes', exact: true }).click();
  await expect(page.getByText('0 bloques pendientes', { exact: true })).toBeVisible();
  expect(translations).toHaveLength(1);
  expect(translations[0].segments).toEqual([{ id: 'p1_b1', text: 'Economic growth depends on investment.' }, { id: 'p2_b1', text: 'Growth in 1983 [illegible].' }]);
  await page.getByRole('button', { name: 'Generar vista previa del PDF', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Descargar PDF traducido', exact: true })).toBeVisible();
  await page.getByLabel('Página', { exact: true }).selectOption('0');
  await page.getByText(/Lectura aplicada por IA ·/).click();
  await page.screenshot({ path: testInfo.outputPath('automatic-ai-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Restaurar lectura anterior', exact: true }).click();
  await expect(page.getByLabel('Texto original / OCR p1_b1')).toHaveValue('Economic [illegible] depends on investment.');
  await expect(page.getByLabel('Español argentino p1_b1')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Descargar PDF traducido', exact: true })).not.toBeVisible();
  expect(errors).toEqual([]);
});
test('provider failure stops, retains successful blocks and retries failed blocks only on an explicit click', async ({ page }) => {
  await fixture(page, 3);
  for (let n = 1; n <= 3; n++) await source(page, n, `Block ${n} [illegible] growth.`);
  const calls: string[] = [];
  let fail = true;
  await page.route('**/api/translation-review', route => {
    const { sourceText } = route.request().postDataJSON(); calls.push(sourceText);
    if (fail && sourceText.includes('2')) return route.fulfill({ status: 502, json: { error: 'provider_quota' } });
    return route.fulfill({ json: { text: sourceText.replace('[illegible]', 'economic'), uncertain: false } });
  });
  await authorize(page); await reviewButton(page).click();
  await expect(page.getByRole('alert').filter({ hasText: 'saldo insuficiente' })).toBeVisible();
  expect(calls).toHaveLength(2);
  await expect(page.getByText('1 bloques dudosos sin revisar', { exact: true })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Reintentar sólo revisiones fallidas (1)', exact: true }).click();
  await expect(page.getByRole('button', { name: /Reintentar sólo revisiones fallidas/ })).not.toBeVisible();
  expect(calls).toHaveLength(3); expect(calls[2]).toContain('2');
  await reviewButton(page).click(); await expect(page.getByText('0 bloques dudosos sin revisar', { exact: true })).toBeVisible();
  await expect(reviewButton(page)).toBeDisabled();
  expect(calls).toHaveLength(4); expect(calls[3]).toContain('3');
  await source(page, 3, 'New [illegible] text.');
  await expect(reviewButton(page)).toBeEnabled();
  await page.getByLabel('Modelo', { exact: true }).fill('gpt-6-sol');
  await expect(page.getByLabel(/^Autorizo la revisión visual por lote/)).not.toBeChecked();
  await expect(reviewButton(page)).toBeDisabled();
  await page.getByLabel(/^Autorizo la revisión visual por lote/).check();
  await page.getByLabel('Clave API (sólo en memoria)', { exact: true }).fill('another-synthetic-key');
  await expect(page.getByLabel(/^Autorizo la revisión visual por lote/)).not.toBeChecked();
  expect(calls).toHaveLength(4);
});
