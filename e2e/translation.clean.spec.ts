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
  await page.getByText('Edición y formatos avanzados', { exact: true }).click();
  await expect(page.getByLabel('Texto original / OCR p1_b2')).toBeVisible();
  await page.getByLabel('Clave API (sólo en memoria)').fill('synthetic-key-not-real');
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
  const run = page.getByRole('button', { name: 'Traducir al español', exact: true });
  await expect(run).toBeDisabled();
  await page.getByLabel(/Autorizo enviar la página elegida/).check();
  await run.click();
  const button = page.getByRole('button', { name: 'Descargar PDF en español' });
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
  const canvas = page.getByLabel('PDF en español', { exact: true });
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

test('a later inclusive range translates only physical pages 20–22 and exports their text', async ({ page }, info) => {
  const doc = await PDFDocument.create();
  for (let n = 1; n <= 22; n++) doc.addPage([400, 400]).drawText(`Source page ${n} has enough text for local analysis.`, { x: 35, y: 340, size: 12 });
  await page.goto('/es/translate');
  await page.locator('#translate-file-input').setInputFiles({ name: 'range.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.getByText('22 páginas')).toBeVisible();
  await page.getByLabel('Un rango').check();
  await page.getByLabel('Desde').fill('20');
  await page.getByLabel('Hasta').fill('22');
  await expect(page.getByText('3 páginas')).toBeVisible();
  await page.screenshot({ path: info.outputPath('range-selector.png') });
  await page.getByRole('button', { name: 'Analizar PDF localmente' }).click();
  await expect(page.getByText('3 bloques pendientes')).toBeVisible();
  await page.getByLabel('Clave API (sólo en memoria)').fill('synthetic-key-not-real');
  const physical: number[] = [];
  await page.route('**/api/translation-clean', route => {
    const body = route.request().postDataJSON();
    const block = body.blocks[0]; physical.push(Number(block.id.match(/^p(\d+)_/)![1]));
    return route.fulfill({ json: { elements: [{ kind: 'paragraph', ids: [block.id], text: block.text,
      box: { x: block.x, y: block.y, width: block.width, height: block.height }, noiseReason: 'none', uncertain: false }] } });
  });
  await page.route('**/api/translate', route => {
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { translations: body.segments.map((segment: { id: string; text: string }) => ({
      id: segment.id, text: segment.text.replace('Source page', 'Pagina de origen').replace('has enough text for local analysis.', 'contiene suficiente texto para el analisis local.'),
    })) } });
  });
  await page.getByLabel(/Autorizo enviar las 3 páginas elegidas/).check();
  await page.getByRole('button', { name: 'Traducir al español', exact: true }).click();
  const download = page.getByRole('button', { name: 'Descargar PDF en español' });
  await expect(download).toBeVisible({ timeout: 60_000 });
  expect(physical).toEqual([20, 21, 22]);
  const event = page.waitForEvent('download'); await download.click();
  const file = info.outputPath('range.pdf'); await (await event).saveAs(file);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = pdfjs.getDocument({ data: new Uint8Array(await readFile(file)), useSystemFonts: true });
  const output = await loading.promise;
  try {
    const texts: string[] = [];
    for (let n = 1; n <= output.numPages; n++) texts.push((await (await output.getPage(n)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '));
    const text = texts.join(' ');
    for (const n of [20, 21, 22]) expect(text).toContain(`Pagina de origen ${n}`);
    for (const n of [19, 23]) expect(text).not.toContain(`Pagina de origen ${n}`);
  } finally { await loading.destroy(); }
});

test('the entire-document choice analyzes beyond the former ten-page trial', async ({ page }) => {
  const doc = await PDFDocument.create();
  for (let n = 1; n <= 12; n++) doc.addPage([400, 400]).drawText(`Source page ${n} has enough text for local analysis.`, { x: 35, y: 340, size: 12 });
  await page.goto('/es/translate');
  await page.locator('#translate-file-input').setInputFiles({ name: 'whole.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.getByText('12 páginas')).toBeVisible();
  await page.getByRole('button', { name: 'Analizar PDF localmente' }).click();
  await expect(page.getByText('12 bloques pendientes')).toBeVisible();
  await expect(page.getByText('Traduciremos 12 páginas con OCR e IA.')).toBeVisible();
});

test('a longer source PDF can be processed as a bounded later range', async ({ page }) => {
  const doc = await PDFDocument.create();
  for (let n = 1; n <= 101; n++) doc.addPage([400, 400]).drawText(`Source page ${n} has enough text for local analysis.`, { x: 35, y: 340, size: 12 });
  await page.goto('/es/translate');
  await page.locator('#translate-file-input').setInputFiles({ name: 'long.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.getByText('101 páginas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analizar PDF localmente' })).toBeDisabled();
  await page.getByLabel('Un rango').check();
  await page.getByLabel('Desde').fill('100'); await page.getByLabel('Hasta').fill('101');
  await page.getByRole('button', { name: 'Analizar PDF localmente' }).click();
  await expect(page.getByText('2 bloques pendientes')).toBeVisible();
  await page.getByText('Edición y formatos avanzados', { exact: true }).click();
  await expect(page.getByLabel('Página', { exact: true })).toContainText('100');
  await page.getByLabel('Página', { exact: true }).selectOption('1');
  await expect(page.getByLabel('Texto original / OCR p101_b1')).toBeVisible();
});

test('invalid structure is retained as a safe failure with no translation or download', async ({ page }) => {
  const doc = await PDFDocument.create(), p = doc.addPage([400, 400]);
  p.drawText('A genuine paragraph in the book.', { x: 35, y: 340, size: 12 });
  await page.goto('/es/translate'); await page.locator('#translate-file-input').setInputFiles({ name: 'unsafe.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await page.getByRole('button', { name: 'Analizar PDF localmente' }).click();
  await page.getByText('Edición y formatos avanzados', { exact: true }).click();
  await expect(page.getByLabel('Texto original / OCR p1_b1')).toBeVisible();
  await page.getByLabel('Clave API (sólo en memoria)').fill('synthetic-key-not-real');
  await page.getByLabel(/Autorizo enviar la página elegida/).check();
  let translations = 0;
  await page.route('**/api/translate', route => { translations++; return route.fulfill({ json: {} }); });
  await page.route('**/api/translation-clean', route => route.fulfill({ json: { elements: [] } }));
  await page.getByRole('button', { name: 'Traducir al español' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'incompleta o inválida' })).toBeVisible();
  expect(translations).toBe(0); await expect(page.getByRole('button', { name: 'Descargar PDF en español' })).not.toBeVisible();
  await expect(page.getByLabel('Texto original / OCR p1_b1')).toHaveValue('A genuine paragraph in the book.');
});

for (const ambiguous of [false, true]) test(`uncertain margin classification ${ambiguous ? 'retains ambiguity and stops' : 'excludes a verified stamp, not body content'}`, async ({ page }, info) => {
  const doc = await PDFDocument.create(), p = doc.addPage([400, 400]);
  p.drawText('Worksheet stamp', { x: 35, y: 380, size: 8 });
  p.drawText('Genuine book paragraph.', { x: 35, y: 280, size: 12 });
  await page.goto('/es/translate'); await page.locator('#translate-file-input').setInputFiles({ name: 'margin.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await page.getByRole('button', { name: 'Analizar PDF localmente' }).click();
  await page.getByText('Edición y formatos avanzados', { exact: true }).click();
  await expect(page.getByLabel('Texto original / OCR p1_b2')).toBeVisible();
  await page.getByLabel('Clave API (sólo en memoria)').fill('synthetic-key-not-real');
  await page.getByLabel(/Autorizo enviar la página elegida/).check();
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
  await page.getByRole('button', { name: 'Traducir al español' }).click();
  const button = page.getByRole('button', { name: 'Descargar PDF en español' });
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
