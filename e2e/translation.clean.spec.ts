import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

test('clean sample exports a new uniform document with an intact figure between its paragraphs', async ({ page }, info) => {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.TimesRoman);
  const p = doc.addPage([400, 400]);
  p.drawText('First paragraph before the chart.', { x: 35, y: 340, size: 14, font });
  p.drawRectangle({ x: 100, y: 170, width: 100, height: 70, color: rgb(0, .4, .9) });
  p.drawText('Second paragraph after the chart.', { x: 35, y: 100, size: 9, font });
  await page.goto('/es/translate');
  await page.locator('#translate-file-input').setInputFiles({ name: 'clean.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await page.getByRole('button', { name: 'Analizar PDF localmente' }).click();
  await expect(page.getByLabel('Texto original / OCR p1_b2')).toBeVisible();
  await page.getByLabel('Clave API (sólo en memoria)').fill('synthetic-key-not-real');
  await page.getByLabel(/Autorizo enviar los textos incluidos/).check();
  let calls = 0;
  await page.route('**/api/translation-clean', route => {
    calls++; const body = route.request().postDataJSON();
    const textElement = (b: typeof body.blocks[0]) => ({ kind: 'paragraph', ids: [b.id], text: b.text,
      box: { x: b.x, y: b.y, width: b.width, height: b.height }, noiseReason: 'none', uncertain: false });
    return route.fulfill({ json: { elements: [textElement(body.blocks[0]),
      // Deliberately clip the proposed bottom: the conservative ink refinement must recover it.
      { kind: 'figure', ids: [], text: '', box: { x: 250, y: 400, width: 250, height: 140 }, noiseReason: 'none', uncertain: false },
      textElement(body.blocks[1])] } });
  });
  await page.route('**/api/translate', route => {
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { translations: body.segments.map((s: { id: string; text: string }) => ({ id: s.id,
      text: s.text.startsWith('First') ? 'Primer párrafo antes del gráfico: φ ≤ 2.' : 'Segundo párrafo después del gráfico: nota⁵.' })) } });
  });
  const run = page.getByRole('button', { name: 'Generar muestra limpia', exact: true });
  await expect(run).toBeDisabled();
  await page.getByLabel(/Autorizo enviar las primeras 10 páginas completas/).check();
  await run.click();
  const button = page.getByRole('button', { name: 'Descargar muestra limpia' });
  await expect(button).toBeVisible({ timeout: 30000 });
  const event = page.waitForEvent('download'); await button.click();
  const file = info.outputPath('clean.pdf'); await (await event).saveAs(file);
  const bytes = await readFile(file), result = await PDFDocument.load(bytes);
  expect(result.getPageCount()).toBe(1);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await loading.promise;
  try {
    const text = await (await pdf.getPage(1)).getTextContent();
    const items = text.items.filter(i => 'str' in i && i.str);
    expect(items.map(i => 'str' in i ? i.str : '').join(' ')).toBe('Primer párrafo antes del gráfico: φ ≤ 2. Segundo párrafo después del gráfico: nota⁵.');
    const fonts = new Set(items.map(i => 'fontName' in i ? i.fontName : ''));
    expect(fonts.size).toBe(1);
    for (const item of items) if ('str' in item) expect(Math.hypot(item.transform[0], item.transform[1])).toBe(12);
    // First text above the figure, second below. Source font sizes/styles are irrelevant.
    const first = items[0], last = items.at(-1)!;
    if ('transform' in first && 'transform' in last) { expect(first.transform[5]).toBeGreaterThan(760); expect(last.transform[5]).toBeLessThan(first.transform[5] - 70); }
  } finally { await loading.destroy(); }
  const canvas = page.getByLabel('Muestra limpia', { exact: true });
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(500);
  const pixel = await canvas.evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(c.width * .5, c.height * .13, 1, 1).data]);
  expect(pixel[2]).toBeGreaterThan(200); expect(pixel[0]).toBeLessThan(20);
  const bottomPixel = await canvas.evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(c.width * .5, c.height * .165, 1, 1).data]);
  expect(bottomPixel[2]).toBeGreaterThan(200); expect(bottomPixel[0]).toBeLessThan(20);
  await canvas.screenshot({ path: info.outputPath('clean-preview.png') });
  await run.click(); await expect(button).toBeVisible(); expect(calls).toBe(1);
  await page.getByLabel('Texto original / OCR p1_b1').fill('Changed source.');
  await expect(button).not.toBeVisible(); await expect(run).toBeDisabled();
});

test('invalid structure is retained as a safe failure with no translation or download', async ({ page }) => {
  const doc = await PDFDocument.create(), p = doc.addPage([400, 400]);
  p.drawText('A genuine paragraph in the book.', { x: 35, y: 340, size: 12 });
  await page.goto('/es/translate'); await page.locator('#translate-file-input').setInputFiles({ name: 'unsafe.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await page.getByRole('button', { name: 'Analizar PDF localmente' }).click();
  await expect(page.getByLabel('Texto original / OCR p1_b1')).toBeVisible();
  await page.getByLabel('Clave API (sólo en memoria)').fill('synthetic-key-not-real');
  await page.getByLabel(/Autorizo enviar los textos incluidos/).check(); await page.getByLabel(/Autorizo enviar las primeras 10 páginas completas/).check();
  let translations = 0;
  await page.route('**/api/translate', route => { translations++; return route.fulfill({ json: {} }); });
  await page.route('**/api/translation-clean', route => route.fulfill({ json: { elements: [] } }));
  await page.getByRole('button', { name: 'Generar muestra limpia' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'incompleta o inválida' })).toBeVisible();
  expect(translations).toBe(0); await expect(page.getByRole('button', { name: 'Descargar muestra limpia' })).not.toBeVisible();
  await expect(page.getByLabel('Texto original / OCR p1_b1')).toHaveValue('A genuine paragraph in the book.');
});

for (const ambiguous of [false, true]) test(`uncertain margin classification ${ambiguous ? 'retains ambiguity and stops' : 'excludes a verified stamp, not body content'}`, async ({ page }, info) => {
  const doc = await PDFDocument.create(), p = doc.addPage([400, 400]);
  p.drawText('Worksheet stamp', { x: 35, y: 380, size: 8 });
  p.drawText('Genuine book paragraph.', { x: 35, y: 280, size: 12 });
  await page.goto('/es/translate'); await page.locator('#translate-file-input').setInputFiles({ name: 'margin.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await page.getByRole('button', { name: 'Analizar PDF localmente' }).click();
  await expect(page.getByLabel('Texto original / OCR p1_b2')).toBeVisible();
  await page.getByLabel('Clave API (sólo en memoria)').fill('synthetic-key-not-real');
  await page.getByLabel(/Autorizo enviar los textos incluidos/).check(); await page.getByLabel(/Autorizo enviar las primeras 10 páginas completas/).check();
  await page.route('**/api/translation-clean', route => {
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { elements: body.blocks.map((b: { id: string; text: string; x: number; y: number; width: number; height: number }, i: number) => ({
      kind: i === 0 ? 'note' : 'paragraph', ids: [b.id], text: b.text,
      box: { x: b.x, y: b.y, width: b.width, height: b.height }, noiseReason: 'none', uncertain: i === 0,
    })) } });
  });
  let reviews = 0, translations = 0;
  await page.route('**/api/translation-review', route => {
    reviews++; const body = route.request().postDataJSON(); expect(body.task).toBe('classify_noise');
    const context = JSON.parse(body.sourceText); expect(context.targetText).toBe('Worksheet stamp'); expect(context.pageContext).toContain('Genuine book paragraph.');
    return route.fulfill({ json: { text: 'Worksheet stamp', uncertain: ambiguous, noiseReason: ambiguous ? 'none' : 'scan_mark' } });
  });
  await page.route('**/api/translate', route => {
    translations++; const body = route.request().postDataJSON();
    return route.fulfill({ json: { translations: body.segments.map((s: { id: string }) => ({ id: s.id, text: 'Párrafo genuino del libro.' })) } });
  });
  await page.getByRole('button', { name: 'Generar muestra limpia' }).click();
  const button = page.getByRole('button', { name: 'Descargar muestra limpia' });
  if (ambiguous) {
    await expect(page.getByRole('alert').filter({ hasText: 'contenido o recortes ambiguos' })).toBeVisible();
    await expect(button).not.toBeVisible(); expect(translations).toBe(0);
  } else {
    await expect(button).toBeVisible({ timeout: 30000 });
    const event = page.waitForEvent('download'); await button.click(); const file = info.outputPath('margin.pdf'); await (await event).saveAs(file);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'), loading = pdfjs.getDocument({ data: new Uint8Array(await readFile(file)), useSystemFonts: true });
    try { const pdf = await loading.promise, text = await (await pdf.getPage(1)).getTextContent();
      expect(text.items.filter(i => 'str' in i && i.str).map(i => 'str' in i ? i.str : '').join(' ')).toBe('Párrafo genuino del libro.');
    } finally { await loading.destroy(); }
  }
  expect(reviews).toBe(1);
});
