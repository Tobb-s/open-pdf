import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDict, PDFDocument, PDFName, PDFStream, PDFString, StandardFonts, rgb, degrees } from 'pdf-lib';

test.setTimeout(60_000);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const canvas = (page: Page) => page.locator('canvas[style*="touch-action"]').first();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
async function fixture({ rotated = false, scan = false, subset = false } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 594]);
  if (scan) page.drawImage(await doc.embedPng(PNG), { x: 40, y: 40, width: 300, height: 400 });
  else {
    const font = await doc.embedFont(subset ? StandardFonts.CourierBold : StandardFonts.TimesRomanBoldItalic);
    for (const y of [510, 450]) page.drawText(subset ? 'ALPHA' : 'Original phrase', { x: 48, y, size: 12.75, font, color: rgb(0.2, 0.4, 0.7) });
    page.drawText('Tiny text', { x: 48, y: 300, size: 6.5, font });
    page.drawRectangle({ x: 20, y: 20, width: 80, height: 20, color: rgb(0.1, 0.6, 0.2) });
    page.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [20, 60, 40, 80], Contents: PDFString.of('Keep this annotation') })));
    if (subset) {
      await font.embed();
      const chars = [...new Set('ALPHATiny text')];
      const cmap = `1 begincodespacerange <00> <FF> endcodespacerange ${chars.length} beginbfchar\n`
        + chars.map(c => `<${c.charCodeAt(0).toString(16)}> <${c.charCodeAt(0).toString(16).padStart(4, '0')}>`).join('\n') + '\nendbfchar';
      doc.context.lookup(font.ref, PDFDict).set(PDFName.of('ToUnicode'), doc.context.register(doc.context.flateStream(cmap)));
    }
  }
  if (rotated) { page.setRotation(degrees(90)); page.setCropBox(20, 20, 380, 550); }
  return Buffer.from(await doc.save());
}
async function ready(page: Page) {
  await expect(canvas(page).locator('xpath=../..')).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
}
async function open(page: Page, options = {}) {
  await page.goto('/es/studio');
  await page.locator('#studio-file-input').setInputFiles({ name: 'precise-synthetic.pdf', mimeType: 'application/pdf', buffer: await fixture(options) });
  await ready(page);
  await button(page, 'Reemplazar').click();
  await ready(page);
}
async function replace(page: Page, value: string) {
  await page.locator('aside textarea').first().fill(value);
  await button(page, 'Aplicar reemplazo').click();
  await expect(page.getByText('1 edición', { exact: true })).toBeVisible({ timeout: 20_000 });
  await ready(page);
}
async function download(page: Page, saveTo?: string) {
  await button(page, 'Exportar').click();
  const pending = page.waitForEvent('download');
  await button(page, 'Descargar').click();
  const artifact = await pending;
  if (saveTo) await artifact.saveAs(saveTo);
  const bytes = await readFile((await artifact.path())!);
  const doc = await PDFDocument.load(bytes);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), stopAtErrors: true,
    standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/' });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const ops = await page.getOperatorList();
    return { doc, items: content.items.filter(i => 'str' in i),
      colors: ops.argsArray.filter((_, i) => ops.fnArray[i] === pdfjs.OPS.setFillRGBColor).map(a => a[0]),
      images: doc.context.enumerateIndirectObjects().filter(([, v]) => v instanceof PDFStream && v.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')).length };
  } finally { await task.destroy(); }
}
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const found: string[] = []; errors.set(page, found);
  page.on('pageerror', e => found.push(e.message));
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

test('inspector identifies source face, fractional size, paint color and geometry', async ({ page }, info) => {
  await open(page);
  await button(page, 'Original phrase').first().click();
  const inspector = page.getByRole('region', { name: 'Formato detectado' });
  await expect(inspector).toContainText('Times-BoldItalic');
  await expect(inspector).toContainText('12,75 pt');
  // PDF.js normalizes PDF's floating-point RGB through its 8-bit paint path.
  await expect(inspector).toContainText('#3366b2');
  await expect(inspector).toContainText('Límites calculados con métricas de la fuente');
  await expect(page.getByRole('combobox', { name: 'Método de reemplazo' })).toHaveValue('native');
  await expect(page.getByRole('spinbutton', { name: 'Tamaño', exact: true })).toHaveValue('12.75');
  await inspector.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('format-inspector.png'), fullPage: true });
});

test('native replacement targets only the second duplicate and keeps vector content and annotation', async ({ page }) => {
  await open(page);
  await button(page, 'Original phrase').nth(1).click();
  await replace(page, 'Updated phrase');
  const result = await download(page);
  expect(result.images).toBe(0);
  expect(result.doc.getPage(0).node.Annots()?.size()).toBe(1);
  expect(result.items.filter(i => i.str === 'Original phrase')).toHaveLength(1);
  expect(result.items.find(i => i.str === 'Updated phrase')?.transform[5]).toBeCloseTo(450);
});

test('native replacement changes size and color while preserving other text formatting', async ({ page }, info) => {
  await open(page);
  await button(page, 'Original phrase').first().click();
  await page.getByRole('spinbutton', { name: 'Tamaño', exact: true }).fill('14.25');
  await page.locator('aside input[type="color"]').fill('#d02030');
  await replace(page, 'Updated phrase');
  const result = await download(page, info.outputPath('native-format-output.pdf'));
  expect(result.items.find(i => i.str === 'Updated phrase')?.height).toBeCloseTo(14.25);
  expect(result.items.find(i => i.str === 'Original phrase')?.height).toBeCloseTo(12.75);
  expect(result.colors).toContain('#d02030');
  expect(result.colors).toContain('#3366b2');
  expect(result.images).toBe(0);
});

test('missing glyphs are refused without adding an edit or rasterizing', async ({ page }) => {
  await open(page);
  await button(page, 'Original phrase').first().click();
  await page.locator('aside textarea').first().fill('字');
  await button(page, 'Aplicar reemplazo').click();
  await expect(page.locator('aside').getByRole('alert')).toContainText('La fuente original no contiene todos los caracteres solicitados');
  await expect(page.getByText('Sin cambios', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Método de reemplazo' })).toHaveValue('native');
});

test('filtered fragment list selects tiny text without a canvas hit', async ({ page }) => {
  await open(page);
  await page.getByText('Fragmentos detectados (3)', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Filtrar fragmentos de esta página' }).fill('Tiny');
  await button(page, 'Fragmentos detectados: Tiny text').click();
  await expect(page.getByRole('region', { name: 'Formato detectado' })).toContainText('6,5 pt');
  await replace(page, 'Tiny edit');
  expect((await download(page)).items.some(i => i.str === 'Tiny edit')).toBe(true);
});

test('image-only page explains OCR rather than claiming font detection', async ({ page }) => {
  await open(page, { scan: true });
  const notice = page.getByRole('status').filter({ hasText: 'No se detectó texto seleccionable' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('OCR no recupera con certeza la tipografía original');
});

test('native replacement keeps rotated and cropped page boxes', async ({ page }) => {
  await open(page, { rotated: true });
  await button(page, 'Original phrase').first().click();
  await replace(page, 'Rotated phrase');
  const result = await download(page);
  expect(result.doc.getPage(0).getRotation().angle).toBe(90);
  expect(result.doc.getPage(0).getCropBox()).toEqual({ x: 20, y: 20, width: 380, height: 550 });
  expect(result.images).toBe(0);
});

test('page reconstruction remains an explicit alternative, with its loss warning', async ({ page }) => {
  await open(page);
  await button(page, 'Original phrase').first().click();
  await page.getByRole('combobox', { name: 'Método de reemplazo' }).selectOption('raster');
  await expect(page.getByText(/Pierde enlaces, formularios y capas de esta página/)).toBeVisible();
  await replace(page, 'Rebuilt phrase');
  const result = await download(page);
  expect(result.images).toBeGreaterThan(0);
  expect(result.items.some(i => i.str === 'Rebuilt phrase')).toBe(true);
});

test('empty replacement removes only the selected fragment and stays vector-based', async ({ page }) => {
  await open(page);
  await button(page, 'Original phrase').first().click();
  await replace(page, '');
  const result = await download(page);
  expect(result.items.filter(i => i.str === 'Original phrase')).toHaveLength(1);
  expect(result.items.find(i => i.str === 'Original phrase')?.transform[5]).toBeCloseTo(450);
  expect(result.images).toBe(0);
});

async function fontGap(page: Page, value = 'ZETA') {
  await open(page, { subset: true });
  await button(page, 'ALPHA').nth(1).click();
  await page.locator('aside textarea').first().fill(value);
  await button(page, 'Aplicar reemplazo').click();
  await expect(page.locator('aside').getByRole('alert')).toContainText('Caracteres no disponibles');
  await expect(page.getByText('Sin cambios', { exact: true })).toBeVisible();
}

test('font-gap recovery names missing characters and preserves a vector PDF with explicit consent', async ({ page }, info) => {
  await fontGap(page);
  const alert = page.locator('aside').getByRole('alert');
  await expect(alert).toContainText('Z, E');
  await expect(alert).toContainText('La forma de las letras puede variar');
  await alert.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('font-recovery.png'), fullPage: true });
  await button(page, 'Reintentar con Courier-Bold').click();
  await expect(page.getByText('1 edición', { exact: true })).toBeVisible();
  await ready(page);
  const result = await download(page, info.outputPath('compatible-font-output.pdf'));
  expect(result.images).toBe(0);
  expect(result.doc.getPage(0).node.Annots()?.size()).toBe(1);
  expect(result.items.filter(i => i.str === 'ALPHA')).toHaveLength(1);
  expect(result.items.find(i => i.str === 'ZETA')?.transform[5]).toBeCloseTo(450);
  expect(result.items.find(i => i.str === 'ZETA')?.height).toBeCloseTo(12.75);
  expect(result.colors).toContain('#3366b2');
});

test('font-gap recovery supports undo and redo', async ({ page }) => {
  await fontGap(page);
  await button(page, 'Reintentar con Courier-Bold').click();
  await expect(page.getByText('1 edición', { exact: true })).toBeVisible();
  await ready(page);
  await button(page, 'Deshacer').click();
  await expect(page.getByText('Sin cambios', { exact: true })).toBeVisible();
  await ready(page);
  await expect(button(page, 'ALPHA')).toHaveCount(2);
  await button(page, 'Rehacer').click();
  await expect(page.getByText('1 edición', { exact: true })).toBeVisible();
  await ready(page);
  await expect(button(page, 'ZETA')).toHaveCount(1);
});

test('font-gap recovery does not silently reuse the compatible choice on another fragment', async ({ page }) => {
  await fontGap(page, '字');
  await button(page, 'Reintentar con Courier-Bold').click();
  await expect(page.locator('aside').getByRole('alert')).toContainText('La fuente compatible tampoco');
  await expect(page.getByText('Sin cambios', { exact: true })).toBeVisible();
  await expect(button(page, 'Reintentar con Courier-Bold')).toHaveCount(0);
  await button(page, 'ALPHA').first().click();
  await page.locator('aside textarea').first().fill('ZETA');
  await button(page, 'Aplicar reemplazo').click();
  await expect(button(page, 'Reintentar con Courier-Bold')).toBeVisible();
});

test('font-gap recovery persists after reload and allows a further native edit', async ({ page }) => {
  await fontGap(page);
  await button(page, 'Reintentar con Courier-Bold').click();
  await expect(page.getByText('1 edición', { exact: true })).toBeVisible();
  await ready(page);
  // Rendering finishes before the 900 ms debounced IndexedDB save. Wait for the
  // committed script, not a fixed sleep or the previous "saved" status label.
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const opening = indexedDB.open('openpdf-studio', 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('session', 'readonly');
      const script = tx.objectStore('session').get('script');
      tx.oncomplete = () => { resolve(script.result?.cursor ?? -1); db.close(); };
      tx.onerror = () => { reject(tx.error); db.close(); };
    };
  }))).toBe(1);
  await page.reload();
  await button(page, 'Seguir donde estaba').click();
  await expect(page.getByText('1 edición', { exact: true })).toBeVisible({ timeout: 20_000 });
  await ready(page);
  await button(page, 'Reemplazar').click();
  await ready(page);
  await button(page, 'ZETA').click();
  await page.locator('aside textarea').first().fill('OMEGA');
  await button(page, 'Aplicar reemplazo').click();
  await expect(page.getByText('2 ediciones', { exact: true })).toBeVisible();
  expect((await download(page)).items.some(i => i.str === 'OMEGA')).toBe(true);
});

test('width refusal offers an explicit natural-width retry', async ({ page }) => {
  await open(page);
  await button(page, 'Original phrase').first().click();
  await page.locator('aside textarea').first().fill('A very long phrase that cannot fit in the original space');
  await button(page, 'Aplicar reemplazo').click();
  await expect(button(page, 'Reintentar con ancho natural')).toBeVisible();
  await button(page, 'Reintentar con ancho natural').click();
  await expect(page.getByText('1 edición', { exact: true })).toBeVisible();
  expect((await download(page)).images).toBe(0);
});

test('page reconstruction recovery only opens settings and retains the typed replacement', async ({ page }) => {
  await fontGap(page);
  await page.getByText('Otra alternativa con pérdidas', { exact: true }).click();
  await button(page, 'Configurar reconstrucción de página').click();
  await expect(page.getByRole('combobox', { name: 'Método de reemplazo' })).toHaveValue('raster');
  await expect(page.locator('aside textarea').first()).toHaveValue('ZETA');
  await expect(page.getByText('Sin cambios', { exact: true })).toBeVisible();
  await expect(page.getByText(/Pierde enlaces, formularios y capas de esta página/)).toBeVisible();
});
