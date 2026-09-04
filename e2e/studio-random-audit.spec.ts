import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const SOURCE_TEXT = 'OpenPDF browser check';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function makePdf(title = SOURCE_TEXT): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.setTitle('Studio browser audit');
  document.setAuthor('OpenPDF tests');
  const page = document.addPage([420, 594]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(title, {
    x: 48,
    y: 520,
    size: 18,
    font,
    color: rgb(0.2, 0.15, 0.5),
  });
  page.drawText('Second line for paragraph editing', {
    x: 48,
    y: 496,
    size: 14,
    font,
    color: rgb(0.12, 0.12, 0.12),
  });
  return Buffer.from(await document.save());
}

const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0);
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

test.setTimeout(60_000);

const stageCanvas = (page: Page) => page.locator('canvas[style*="touch-action"]').first();

async function waitForStage(page: Page) {
  const canvas = stageCanvas(page);
  await expect(canvas).toBeVisible();
  await expect(canvas.locator('xpath=../..')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });
}

async function openStudio(page: Page, name = 'studio-audit.pdf', bytes?: Buffer) {
  await page.goto('/es/studio');
  await expect(page.getByRole('heading', { name: 'OpenPDF Studio' })).toBeVisible();
  await page.locator('#studio-file-input').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: bytes ?? (await makePdf()),
  });
  await expect(page.getByText(name)).toBeVisible();
  await waitForStage(page);
  await expect
    .poll(() => stageCanvas(page).evaluate((canvas) => (canvas as HTMLCanvasElement).width))
    .toBeGreaterThan(0);
}

async function expectEdits(page: Page, count: number) {
  const label = count === 1 ? '1 edición' : `${count} ediciones`;
  await expect(page.getByText(label, { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function pointOnPage(page: Page, x = 0.55, y = 0.45) {
  const canvas = stageCanvas(page);
  await waitForStage(page);
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas).toBeInViewport();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Studio canvas has no visible bounds');
  await canvas.click({ position: { x: box.width * x, y: box.height * y } });
}

async function drawOnPage(
  page: Page,
  from: [number, number] = [0.2, 0.2],
  to: [number, number] = [0.55, 0.35],
  steps = 8
) {
  const canvas = stageCanvas(page);
  await waitForStage(page);
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas).toBeInViewport();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Studio canvas has no visible bounds');
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps });
  await page.mouse.up();
}

async function exportReady(page: Page) {
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect(page.getByRole('heading', { name: /página exportada/ })).toBeVisible({
    timeout: 30_000,
  });
}

test('01 · text placement supports undo and redo', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Texto', exact: true }).click();
  await page.getByPlaceholder('Escribí acá…').fill('Added in Studio');
  await pointOnPage(page);
  await expectEdits(page, 1);

  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  await expect(page.getByText('Sin cambios', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rehacer', exact: true }).click();
  await expectEdits(page, 1);
  await exportReady(page);
});

test('02 · rectangle and ellipse rebuild into the preview', async ({ page }, testInfo) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Rectángulo', exact: true }).click();
  await drawOnPage(page, [0.18, 0.28], [0.55, 0.48]);
  await expectEdits(page, 1);

  await page.getByRole('button', { name: 'Elipse', exact: true }).click();
  await drawOnPage(page, [0.5, 0.55], [0.82, 0.72]);
  await expectEdits(page, 2);
  await waitForStage(page);
  await page.screenshot({ path: testInfo.outputPath('studio-shapes.png'), fullPage: true });
  await exportReady(page);
});

test('03 · freehand ink and an arrowed line both persist', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Lápiz', exact: true }).click();
  await drawOnPage(page, [0.2, 0.6], [0.7, 0.7], 16);
  await expectEdits(page, 1);

  await page.getByRole('button', { name: 'Línea', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Con punta de flecha', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await drawOnPage(page, [0.2, 0.5], [0.75, 0.5]);
  await expectEdits(page, 2);
  await exportReady(page);
});

test('04 · an uploaded image can be stamped onto the page', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Imagen', exact: true }).click();
  await page.locator('aside input[accept="image/png,image/jpeg"]').setInputFiles({
    name: 'stamp.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(page.getByText('stamp.png', { exact: true })).toBeVisible();
  await pointOnPage(page, 0.72, 0.35);
  await expectEdits(page, 1);
  await exportReady(page);
});

test('05 · a typed electronic signature is prepared and placed', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Firmar', exact: true }).click();
  await page.getByLabel('Nombre del firmante').fill('Ada Auditora');
  await page.getByRole('button', { name: 'Preparar firma', exact: true }).click();
  await expect(page.getByText(/Firma lista:/)).toBeVisible();
  await pointOnPage(page, 0.62, 0.72);
  await expectEdits(page, 1);
  await exportReady(page);
});

test('06 · crop reset and page rotation remain reversible', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Recortar', exact: true }).click();
  await drawOnPage(page, [0.12, 0.12], [0.88, 0.86]);
  await expectEdits(page, 1);
  await page.getByRole('button', { name: 'Quitar el recorte', exact: true }).click();
  await expectEdits(page, 2);
  await page.getByRole('button', { name: 'Girar a la derecha', exact: true }).click();
  await expectEdits(page, 3);
  await exportReady(page);
});

test('07 · secure redaction rasterizes the selected area', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Tachar', exact: true }).click();
  await drawOnPage(page, [0.12, 0.3], [0.82, 0.45]);
  await expectEdits(page, 1);
  await exportReady(page);
});

test('08 · eraser removes an area through the same safe raster path', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Goma', exact: true }).click();
  await drawOnPage(page, [0.12, 0.3], [0.82, 0.45]);
  await expectEdits(page, 1);
  await exportReady(page);
});

test('09 · highlight, underline and strikeout annotations coexist', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: 'Resaltar', exact: true }).click();
  await drawOnPage(page, [0.15, 0.28], [0.62, 0.33]);
  await expectEdits(page, 1);

  await page.getByRole('button', { name: 'Subrayar', exact: true }).click();
  await drawOnPage(page, [0.15, 0.4], [0.58, 0.44]);
  await expectEdits(page, 2);
  await page.getByRole('button', { name: 'Tachar texto', exact: true }).click();
  await drawOnPage(page, [0.15, 0.52], [0.62, 0.56]);
  await expectEdits(page, 3);
  await exportReady(page);
});

test('10 · a review comment accepts a threaded reply', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: 'Nota', exact: true }).click();
  await page.getByPlaceholder('Escribí el comentario…').fill('Please verify this paragraph.');
  await pointOnPage(page, 0.76, 0.28);
  await expectEdits(page, 1);
  await expect(page.getByText('Please verify this paragraph.', { exact: true })).toBeVisible();

  await page.getByPlaceholder('Responder…').fill('Verified in Chromium.');
  await page.getByRole('button', { name: 'Responder', exact: true }).click();
  await expectEdits(page, 2);
  await expect(page.getByText('Verified in Chromium.', { exact: true })).toBeVisible();
});

test('11 · selected text can be replaced and exported', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Reemplazar', exact: true }).click();
  await page.getByRole('button', { name: SOURCE_TEXT, exact: true }).click();
  await page.locator('aside textarea').first().fill('OpenPDF improved check');
  await page.getByRole('button', { name: 'Aplicar reemplazo', exact: true }).click();
  await expectEdits(page, 1);
  await exportReady(page);
});

test('12 · a detected paragraph can be reflowed', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Párrafo', exact: true }).click();
  await page.getByRole('button', { name: /OpenPDF browser check/ }).first().click();
  await page.locator('aside textarea').first().fill('Short edited paragraph');
  const apply = page.getByRole('button', { name: 'Aplicar edición de párrafo', exact: true });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expectEdits(page, 1);
  await exportReady(page);
});

test('13 · document search rewrites text and sanitizes metadata', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('tab', { name: 'Buscar', exact: true }).click();
  await page.getByRole('searchbox').fill('browser');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByText('1 coincidencia', { exact: true })).toBeVisible();
  await page.locator('aside input[type="text"]').last().fill('viewer');
  await page.getByRole('button', { name: 'Reemplazar sin rehacer la página', exact: true }).click();
  await expectEdits(page, 1);
  await expect(page.getByText('Se reemplazó 1 aparición.', { exact: true })).toBeVisible();

  await page.getByRole('checkbox', { name: 'Metadatos del documento', exact: true }).check();
  await page.getByRole('button', { name: 'Aplicar sanitización', exact: true }).click();
  await expectEdits(page, 2);
  await exportReady(page);
});

test('14 · metadata, watermark, numbering and OCR work together', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('tab', { name: 'Documento', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Audited Studio document');
  await page.getByLabel('Texto', { exact: true }).fill('DRAFT');
  await page.getByRole('button', { name: 'Solo el número', exact: true }).click();
  await expectEdits(page, 3);

  await page.getByRole('button', { name: 'Reconocer el texto de esta página', exact: true }).click();
  await expect(
    page.getByText(/palabra reconocida|palabras reconocidas|No se reconoció ninguna palabra/)
  ).toBeVisible({ timeout: 45_000 });
  await exportReady(page);
});

test('15 · image-page insertion and PDF comparison complete', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('tab', { name: 'Documento', exact: true }).click();
  await page.locator('aside input[accept="image/png,image/jpeg"][multiple]').setInputFiles({
    name: 'inserted.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expectEdits(page, 1);
  await expect(page.getByText(/Página \d de 2/, { exact: true }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Comparar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Comparar versiones PDF' })).toBeVisible();
  await page.locator('#studio-compare-file').setInputFiles({
    name: 'reference.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf('Changed reference version'),
  });
  await expect(page.getByLabel('Resumen de diferencias')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('reference.pdf', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar informe', exact: true })).toBeVisible();
});
