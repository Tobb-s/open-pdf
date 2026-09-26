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

test('readable export keeps complete text, images, minimum body size and source/output navigation', async ({ page }, testInfo) => {
  await page.goto('/es/translate'); await native(page, 2);
  const translation = 'La inversión y la educación mejoran la productividad económica. '.repeat(140) + 'MARCAFINAL';
  await page.getByLabel('Español argentino p1_b1').fill(translation);
  await page.getByLabel('Página', { exact: true }).selectOption('1');
  await page.getByLabel('Español argentino p2_b1').fill('Segunda página.');
  await page.getByLabel('Formato de salida').selectOption('readable');
  await page.getByRole('button', { name: 'Generar vista previa del PDF' }).click();
  const downloadButton = page.getByRole('button', { name: 'Descargar PDF traducido' });
  await expect(downloadButton).toBeVisible({ timeout: 30_000 });
  const download = page.waitForEvent('download'); await downloadButton.click();
  const file = testInfo.outputPath('readable.pdf'); await (await download).saveAs(file);
  const bytes = await readFile(file), doc = await PDFDocument.load(bytes);
  const count = doc.getPageCount(); expect(count).toBeGreaterThan(3);
  expect(doc.getPage(0).getSize()).toEqual({ width: 400, height: 436 });
  expect(doc.getPage(count - 1).getSize()).toEqual({ width: 400, height: 400 });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await loading.promise; const body: string[] = [];
  try {
    for (let n = 2; n < count; n++) {
      const items = (await (await pdf.getPage(n)).getTextContent()).items;
      for (const item of items) if ('str' in item && item.str && !/^(Traducción -|p1_b1|OpenPDF -)/.test(item.str)) {
        expect(Math.hypot(item.transform[0], item.transform[1])).toBeGreaterThanOrEqual(11);
        expect(item.transform[4]).toBeGreaterThanOrEqual(36);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(364.1);
        body.push(item.str);
      }
    }
    expect(body.join(' ').replace(/\s+/g, ' ').trim()).toBe(translation.trim());
  } finally { await loading.destroy(); }
  const selector = page.getByLabel('Página del PDF generado');
  await expect(selector.locator('option')).toHaveCount(count);
  await expect(selector).toHaveValue(String(count));
  await page.getByLabel('Página', { exact: true }).selectOption('0');
  await expect(selector).toHaveValue('1');
  const canvas = page.getByLabel('Resultado generado', { exact: true });
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.height / c.width)).toBeCloseTo(436 / 400, 2);
  const pixel = await canvas.evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(c.width * .375, c.height * (436 - 130) / 436, 1, 1).data]);
  expect(pixel[2]).toBeGreaterThan(200); expect(pixel[0]).toBeLessThan(20);
  await canvas.screenshot({ path: testInfo.outputPath('readable-source.png') });
  await selector.selectOption('2');
  await expect(canvas).toHaveAttribute('data-rendered-page', '2');
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.height / c.width)).toBeCloseTo(1, 2);
  await canvas.screenshot({ path: testInfo.outputPath('readable-continuation.png') });
  await selector.selectOption(String(count - 1));
  await expect(canvas).toHaveAttribute('data-rendered-page', String(count - 1));
  await canvas.screenshot({ path: testInfo.outputPath('readable-final-continuation.png') });
  await page.getByLabel('Formato de salida').selectOption('preserve');
  await expect(downloadButton).not.toBeVisible();
  await expect(page.getByLabel('Español argentino p1_b1')).toHaveValue(translation);
});

test('readable mode keeps short text in place and still rejects unsupported characters', async ({ page }, testInfo) => {
  await page.goto('/es/translate'); await native(page);
  await page.getByLabel('Formato de salida').selectOption('readable');
  await expect(page.getByRole('button', { name: 'Generar vista previa del PDF' })).toBeDisabled();
  await page.getByLabel('Español argentino p1_b1').fill('Texto 漢');
  await page.getByRole('button', { name: 'Generar vista previa del PDF' }).click();
  await expect(page.getByText(/Hay caracteres que la fuente/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar PDF traducido' })).not.toBeVisible();
  await page.getByLabel('Español argentino p1_b1').fill('Crecimiento económico.');
  await page.getByRole('button', { name: 'Generar vista previa del PDF' }).click();
  const button = page.getByRole('button', { name: 'Descargar PDF traducido' });
  await expect(button).toBeVisible();
  const download = page.waitForEvent('download'); await button.click();
  const file = testInfo.outputPath('readable-short.pdf'); await (await download).saveAs(file);
  const doc = await PDFDocument.load(await readFile(file));
  expect(doc.getPageCount()).toBe(1); expect(doc.getPage(0).getSize()).toEqual({ width: 400, height: 400 });
});

async function prepareRegion(page: Page) {
  await page.getByText('Revisar región difícil (OCR + IA)', { exact: true }).click();
  await page.getByRole('button', { name: 'Preparar recorte y releer OCR p1_b1', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Recorte del bloque p1_b1' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Preparar recorte y releer OCR p1_b1', exact: true })).toBeEnabled({ timeout: 90_000 });
}

test('regional local OCR and vision produce proposals, applying changes only one block and clears its translation', async ({ page }, testInfo) => {
  await page.goto('/es/translate'); await native(page, 2); await credentials(page); await fakeProvider(page);
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect(page.getByRole('status')).toHaveText('0 bloques pendientes');
  const original = await page.getByLabel('Texto original / OCR p1_b1').inputValue();
  await prepareRegion(page);
  const localChoice = page.getByRole('button', { name: 'Usar como propuesta OCR 6', exact: true });
  await expect(localChoice).toBeVisible(); await localChoice.click();
  await expect(page.getByLabel('Propuesta de texto original p1_b1')).toHaveValue(/Economic growth depends on investment/i);
  await expect(page.getByLabel('Texto original / OCR p1_b1')).toHaveValue(original);
  const vision = page.getByRole('button', { name: 'Revisar recorte con IA p1_b1', exact: true });
  await expect(vision).toBeDisabled();
  const calls: { image: string; sourceText: string; consent: boolean }[] = [];
  await page.route('**/api/translation-review', route => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({ json: { text: 'Economic growth depends on education.', uncertain: true } });
  });
  await page.getByLabel(/Autorizo enviar este recorte/).check(); await vision.click();
  await expect(page.getByText(/Hay partes ambiguas o ilegibles/)).toBeVisible();
  expect(calls).toHaveLength(1); expect(Object.keys(calls[0]).sort()).toEqual(['consent', 'image', 'model', 'sourceText']);
  expect(calls[0].image).toMatch(/^data:image\/png;base64,/); expect(calls[0].sourceText).toBe(original);
  expect(JSON.stringify(calls)).not.toContain('La inversión');
  await expect(page.getByLabel('Español argentino p1_b1')).toHaveValue('La inversión impulsa el crecimiento.');
  await page.getByRole('button', { name: 'Usar como propuesta IA', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('regional-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Aplicar propuesta al original', exact: true }).click();
  await expect(page.getByLabel('Texto original / OCR p1_b1')).toHaveValue('Economic growth depends on education.');
  await expect(page.getByLabel('Español argentino p1_b1')).toHaveValue('');
  await expect(page.getByRole('status')).toHaveText('1 bloques pendientes');
  await page.getByLabel('Página', { exact: true }).selectOption('1');
  await expect(page.getByLabel('Español argentino p2_b1')).toHaveValue('La inversión impulsa el crecimiento.');
});

test('regional consent resets on key changes; quota failure does not retry or change source', async ({ page }) => {
  await page.goto('/es/translate'); await native(page); await credentials(page); await prepareRegion(page);
  const consent = page.getByLabel(/Autorizo enviar este recorte/);
  await consent.check();
  await page.getByLabel('Clave API (sólo en memoria)').fill('another-synthetic-key');
  await expect(consent).not.toBeChecked();
  const original = await page.getByLabel('Texto original / OCR p1_b1').inputValue(); let calls = 0;
  await page.route('**/api/translation-review', route => {
    calls++; return route.fulfill({ status: 502, json: { error: 'provider_quota' } });
  });
  await consent.check(); await page.getByRole('button', { name: 'Revisar recorte con IA p1_b1', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'No se reintentó automáticamente' })).toBeVisible();
  expect(calls).toBe(1);
  await expect(page.getByLabel('Texto original / OCR p1_b1')).toHaveValue(original);
  await page.unroute('**/api/translation-review');
  await page.route('**/api/translation-review', route => route.fulfill({ json: { text: 'Text \u0003 symbol', uncertain: true } }));
  await page.getByRole('button', { name: 'Revisar recorte con IA p1_b1', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'incompleta o inválida' })).toBeVisible();
  await expect(page.getByLabel('Texto original / OCR p1_b1')).toHaveValue(original);
  await expect(page.getByRole('button', { name: 'Usar como propuesta IA', exact: true })).not.toBeVisible();
  await page.getByRole('combobox', { name: 'Proveedor', exact: true }).selectOption('gemini');
  await expect(page.getByLabel('Clave API (sólo en memoria)')).toHaveValue('');
  await prepareRegion(page);
  await expect(page.getByLabel(/Autorizo enviar este recorte/)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Revisar recorte con IA p1_b1', exact: true })).toBeDisabled();
});

test('cancelling regional vision preserves source and OCR proposals for a manual retry', async ({ page }) => {
  await page.goto('/es/translate'); await native(page); await credentials(page); await prepareRegion(page);
  const original = await page.getByLabel('Texto original / OCR p1_b1').inputValue(); let called = false;
  await page.route('**/api/translation-review', async route => {
    called = true; await new Promise(resolve => setTimeout(resolve, 2000)); await route.abort().catch(() => {});
  });
  await page.getByLabel(/Autorizo enviar este recorte/).check();
  await page.getByRole('button', { name: 'Revisar recorte con IA p1_b1', exact: true }).click();
  await expect.poll(() => called).toBe(true); await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Revisar recorte con IA p1_b1', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Texto original / OCR p1_b1')).toHaveValue(original);
  await expect(page.getByRole('button', { name: 'Usar como propuesta OCR 6', exact: true })).toBeVisible();
});

test('partial completion keeps valid blocks and retries only pending blocks in smaller batches', async ({ page }) => {
  await page.goto('/es/translate'); await native(page, 4); await credentials(page);
  const calls: string[][] = [];
  const contexts: { id: string; translation?: string }[][] = [];
  await page.route('**/api/translate', route => {
    const body = route.request().postDataJSON();
    const segments = body.segments as { id: string }[];
    contexts.push(body.context);
    calls.push(segments.map(s => s.id));
    return route.fulfill({ json: { translations: (calls.length === 1 ? segments.slice(0, 1) : segments)
      .map(s => ({ id: s.id, text: `Traducción ${s.id}` })), missingIds: [] } });
  });
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Se conservaron los válidos' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('3 bloques pendientes');
  await expect(page.getByText(/Recuperación manual:/)).toContainText('hasta 2 bloques');
  expect(calls).toEqual([['p1_b1', 'p2_b1', 'p3_b1', 'p4_b1']]);
  await expect(page.getByRole('button', { name: 'Generar vista previa del PDF' })).toBeDisabled();
  // A user's correction must survive recovery of other blocks.
  await page.getByLabel('Español argentino p1_b1').fill('Traducción revisada por el usuario.');
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect(page.getByRole('status')).toHaveText('0 bloques pendientes');
  expect(calls).toEqual([['p1_b1', 'p2_b1', 'p3_b1', 'p4_b1'], ['p2_b1', 'p3_b1'], ['p4_b1']]);
  expect(contexts[0]).toEqual([]);
  expect(contexts[1]).toContainEqual(expect.objectContaining({ id: 'p1_b1', translation: 'Traducción revisada por el usuario.' }));
  expect(contexts[2]).toContainEqual(expect.objectContaining({ id: 'p3_b1', translation: 'Traducción p3_b1' }));
  await expect(page.getByLabel('Español argentino p1_b1')).toHaveValue('Traducción revisada por el usuario.');
  await expect(page.getByRole('button', { name: 'Generar vista previa del PDF' })).toBeEnabled();
  await page.getByLabel('Página', { exact: true }).selectOption('3');
  await expect(page.getByLabel('Español argentino p4_b1')).toHaveValue('Traducción p4_b1');
  // New analysis clears recovery limits and stale errors.
  await native(page);
  await expect(page.getByText(/Recuperación manual:/)).not.toBeVisible();
});

test('context excludes unchecked blocks and disabling it resets consent', async ({ page }) => {
  await page.goto('/es/translate'); await native(page, 4);
  await page.getByLabel('Español argentino p1_b1').fill('Referencia corregida.');
  await page.getByLabel('Página', { exact: true }).selectOption('1');
  await page.getByLabel(/p2_b1 · Traducir este bloque/).uncheck();
  await page.getByLabel('Glosario opcional (término = traducción)').fill('growth = crecimiento');
  await credentials(page);
  let body: { segments: { id: string }[]; context: { id: string; translation?: string }[]; glossary: string } | undefined;
  await page.route('**/api/translate', route => {
    body = route.request().postDataJSON();
    return route.fulfill({ json: { translations: body!.segments.map(s => ({ id: s.id, text: 'Crecimiento económico.' })) } });
  });
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect(page.getByRole('status')).toHaveText('0 bloques pendientes');
  expect(body!.segments.map(s => s.id)).toEqual(['p3_b1', 'p4_b1']);
  expect(body!.context).toEqual([expect.objectContaining({ id: 'p1_b1', translation: 'Referencia corregida.' })]);
  expect(body!.glossary).toBe('growth = crecimiento');
  expect(JSON.stringify(body)).not.toContain('p2_b1');
  await page.getByLabel('Usar contexto entre páginas y lotes').uncheck();
  await expect(page.getByLabel(/Autorizo enviar/)).not.toBeChecked();
  // Retranslate a deliberately cleared target with context disabled.
  await page.getByLabel('Página', { exact: true }).selectOption('2');
  await page.getByLabel('Español argentino p3_b1').fill('');
  await expect(page.getByRole('button', { name: 'Traducir pendientes' })).toBeDisabled();
  await credentials(page); await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect(page.getByRole('status')).toHaveText('0 bloques pendientes');
  expect(body!.context).toEqual([]);
});

test('a returned context ID cannot overwrite its reference or apply a target translation', async ({ page }) => {
  await page.goto('/es/translate'); await native(page, 3);
  await page.getByLabel('Español argentino p1_b1').fill('Referencia intacta.');
  await credentials(page);
  await page.route('**/api/translate', route => route.fulfill({ json: { translations: [
    { id: 'p2_b1', text: 'Traducción solicitada.' }, { id: 'p1_b1', text: 'Referencia sobrescrita.' },
  ] } }));
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'No se aplicó ese lote' })).toBeVisible();
  await expect(page.getByLabel('Español argentino p1_b1')).toHaveValue('Referencia intacta.');
  await page.getByLabel('Página', { exact: true }).selectOption('1');
  await expect(page.getByLabel('Español argentino p2_b1')).toHaveValue('');
  await expect(page.getByRole('status')).toHaveText('2 bloques pendientes');
});

test('ambiguous IDs apply nothing and manual recovery splits the rejected batch', async ({ page }) => {
  await page.goto('/es/translate'); await native(page, 3); await credentials(page);
  const calls: string[][] = [];
  await page.route('**/api/translate', route => {
    const segments = route.request().postDataJSON().segments as { id: string }[];
    calls.push(segments.map(s => s.id));
    return route.fulfill({ json: { translations: (calls.length === 1 ? [segments[0], segments[0]] : segments)
      .map(s => ({ id: s.id, text: 'Texto válido pero ambiguo.' })) } });
  });
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'No se aplicó ese lote' })).toBeVisible();
  await expect(page.getByLabel('Español argentino p1_b1')).toHaveValue('');
  await expect(page.getByRole('status')).toHaveText('3 bloques pendientes');
  expect(calls).toHaveLength(1);
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect(page.getByRole('status')).toHaveText('0 bloques pendientes');
  expect(calls).toEqual([['p1_b1', 'p2_b1', 'p3_b1'], ['p1_b1'], ['p2_b1'], ['p3_b1']]);
});

test('cancelling recovery retains earlier accepted blocks and sends only the remainder next time', async ({ page }) => {
  await page.goto('/es/translate'); await native(page, 3); await credentials(page);
  const calls: string[][] = [];
  let delayed = false;
  await page.route('**/api/translate', async route => {
    const segments = route.request().postDataJSON().segments as { id: string }[];
    calls.push(segments.map(s => s.id));
    if (calls.length === 3) {
      delayed = true; await new Promise(resolve => setTimeout(resolve, 2000));
      await route.abort().catch(() => {}); return;
    }
    await route.fulfill({ json: { translations: (calls.length === 1 ? segments.slice(0, 1) : segments)
      .map(s => ({ id: s.id, text: `Aceptado ${s.id}` })) } });
  });
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect(page.getByRole('status')).toHaveText('2 bloques pendientes');
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect.poll(() => delayed).toBe(true);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Traducir pendientes' })).toBeEnabled();
  await expect(page.getByRole('status')).toHaveText('1 bloques pendientes');
  await page.getByLabel('Página', { exact: true }).selectOption('1');
  await expect(page.getByLabel('Español argentino p2_b1')).toHaveValue('Aceptado p2_b1');
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect(page.getByRole('status')).toHaveText('0 bloques pendientes');
  expect(calls).toEqual([['p1_b1', 'p2_b1', 'p3_b1'], ['p2_b1'], ['p3_b1'], ['p3_b1']]);
});

test('quota errors do not schedule automatic recovery requests', async ({ page }) => {
  await page.goto('/es/translate'); await native(page, 2); await credentials(page);
  let calls = 0;
  await page.route('**/api/translate', route => {
    calls++; return route.fulfill({ status: 502, json: { error: 'provider_quota' } });
  });
  await page.getByRole('button', { name: 'Traducir pendientes' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'No se reintentó automáticamente' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('2 bloques pendientes');
  await expect(page.getByText(/Recuperación manual:/)).not.toBeVisible();
  expect(calls).toBe(1);
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
