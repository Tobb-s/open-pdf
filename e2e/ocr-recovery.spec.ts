import { test, expect, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

test.setTimeout(120_000);
type Audit = { requests: number; held: number; fireTimeout?: () => void };
declare global { interface Window { ocrRecoveryAudit: Audit } }

/** Real OCR for completed pages; deliberately withhold one request to exercise the actual timeout/abort path. */
async function interruptRequests(page: Page, requests: number[]) {
  await page.addInitScript((blocked) => {
    window.ocrRecoveryAudit = { requests: 0, held: 0 };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        if ((message as { action?: string })?.action === 'recognize') {
          const count = ++window.ocrRecoveryAudit.requests;
          if (blocked.includes(count)) { window.ocrRecoveryAudit.held = count; return; }
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
    const nativeTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 90_000 && typeof callback === 'function') {
        window.ocrRecoveryAudit.fireTimeout = () => callback(...args);
      }
      return nativeTimeout(callback, delay, ...args);
    }) as typeof window.setTimeout;
  }, requests);
}

async function fixture(page: Page, pages = 2) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900; canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 900, 300);
    ctx.fillStyle = 'black'; ctx.font = '40px monospace';
    ctx.fillText('CHECKPOINT OCR 12345', 40, 100);
    ctx.fillText('Documento de prueba local', 40, 180);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(Buffer.from(data, 'base64'));
  for (let i = 0; i < pages; i++) pdf.addPage([450, 150]).drawImage(image, { x: 0, y: 0, width: 450, height: 150 });
  return Buffer.from(await pdf.save());
}

async function start(page: Page, buffer: Buffer) {
  await page.locator('#ocr-file-input').setInputFiles({ name: 'recovery.pdf', mimeType: 'application/pdf', buffer });
  await page.getByLabel('Calidad de lectura').selectOption('quick');
  await page.getByLabel('Giro para leer (no gira el PDF)').selectOption('0');
  await page.getByRole('button', { name: 'Empezar el OCR', exact: true }).click();
}

async function download(page: Page, partial: boolean) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: partial ? /^PDF buscable parcial/ : /^PDF buscable/ }).click();
  const downloaded = await event;
  expect(downloaded.suggestedFilename()).toContain(partial ? '_searchable_partial.pdf' : '_searchable.pdf');
  return readFile((await downloaded.path())!);
}

async function texts(bytes: Uint8Array) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const text = await (await doc.getPage(i)).getTextContent();
      pages.push(text.items.filter(item => 'str' in item).map(item => item.str).join(' '));
    }
    return pages;
  } finally { await task.destroy(); }
}

for (const interruption of ['cancel', 'timeout'] as const) {
  test(`${interruption} retains completed pages, exports partial and resumes with corrections`, async ({ page }, testInfo) => {
    await interruptRequests(page, [2]);
    await page.goto('/es/ocr');
    await start(page, await fixture(page));
    await page.waitForFunction(() => window.ocrRecoveryAudit.held === 2);
    if (interruption === 'cancel') await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    else await page.evaluate(() => window.ocrRecoveryAudit.fireTimeout!());
    await expect(page.getByRole('heading', { name: 'OCR parcial — avance conservado' })).toBeVisible();
    await expect(page.locator('pre')).toContainText('OCR PARCIAL: 1 de 2');
    await page.screenshot({ path: testInfo.outputPath('ocr-partial.png'), fullPage: true });
    await page.getByLabel('Sólo palabras dudosas (<60)').uncheck();
    await page.getByRole('button', { name: /^CHECKPOINT / }).click();
    await page.getByLabel('Corregir palabra OCR (no modifica la imagen)').fill('CORREGIDO');
    const partial = await texts(await download(page, true));
    expect(partial).toHaveLength(2);
    expect(partial[0]).toContain('CORREGIDO');
    expect(partial[1]).toBe('');
    await page.getByRole('button', { name: 'Reanudar desde la página 2', exact: true }).click();
    await expect(page.getByRole('button', { name: /^PDF buscable parcial/ })).toHaveCount(0);
    await expect(page.locator('[data-ocr-page]')).toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => window.ocrRecoveryAudit.requests)).toBe(3);
    await expect(page.locator('pre')).not.toContainText('OCR PARCIAL');
    const complete = await texts(await download(page, false));
    expect(complete[0].match(/CORREGIDO/g)).toHaveLength(1);
    expect(complete[0]).not.toContain('CHECKPOINT');
    expect(complete[1].match(/CHECKPOINT/g)).toHaveLength(1);
  });
}

test('repeated interruption retains the same checkpoint and marks plain text partial', async ({ page }) => {
  await interruptRequests(page, [2, 3]);
  await page.goto('/es/ocr');
  await start(page, await fixture(page));
  for (const request of [2, 3]) {
    await page.waitForFunction(count => window.ocrRecoveryAudit.held === count, request);
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reanudar desde la página 2', exact: true })).toBeEnabled();
    await expect(page.locator('pre')).toContainText('OCR PARCIAL: 1 de 2');
    if (request === 2) await page.getByRole('button', { name: 'Reanudar desde la página 2', exact: true }).click();
  }
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: /Texto plano/ }).click();
  const output = await event;
  expect(output.suggestedFilename()).toContain('_extracted_partial.txt');
  expect(await readFile((await output.path())!, 'utf8')).toContain('OCR PARCIAL: 1 de 2');
});

test('discarding a checkpoint permits new options and a different file without stale results', async ({ page }) => {
  await interruptRequests(page, [2]);
  await page.goto('/es/ocr');
  await start(page, await fixture(page));
  await page.waitForFunction(() => window.ocrRecoveryAudit.held === 2);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Descartar avance y cambiar opciones OCR', exact: true }).click();
  await expect(page.getByLabel('Calidad de lectura')).toBeEnabled();
  await start(page, await fixture(page, 1));
  await expect(page.locator('[data-ocr-page]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('pre')).not.toContainText('Page 2');
  expect(await texts(await download(page, false))).toHaveLength(1);
});

test('cancelling before any completed page allows a clean retry', async ({ page }) => {
  await interruptRequests(page, [1]);
  await page.goto('/es/ocr');
  await start(page, await fixture(page, 1));
  await page.waitForFunction(() => window.ocrRecoveryAudit.held === 1);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Empezar el OCR', exact: true })).toBeEnabled();
  await expect(page.locator('[data-ocr-page]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Empezar el OCR', exact: true }).click();
  await expect(page.locator('pre')).toContainText('CHECKPOINT', { timeout: 60_000 });
});

test('an export failure retains recognized pages and allows another download', async ({ page }) => {
  await page.goto('/es/ocr');
  await start(page, await fixture(page, 1));
  await expect(page.locator('pre')).toContainText('CHECKPOINT', { timeout: 60_000 });
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      File.prototype.arrayBuffer = original;
      return Promise.reject(new Error('Injected export read failure'));
    };
  });
  await page.getByRole('button', { name: /^PDF buscable/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Injected export read failure' })).toBeVisible();
  await expect(page.locator('pre')).toContainText('CHECKPOINT');
  expect((await texts(await download(page, false)))[0]).toContain('CHECKPOINT');
});

test('native pages are checkpoints too and are not repeated on resume', async ({ page }) => {
  await interruptRequests(page, [1]);
  await page.goto('/es/ocr');
  const doc = await PDFDocument.create();
  doc.addPage([450, 150]).drawText('NATIVE CHECKPOINT', { x: 20, y: 80, size: 15 });
  const scan = await PDFDocument.load(await fixture(page, 1));
  const [second] = await doc.copyPages(scan, [0]);
  doc.addPage(second);
  await start(page, Buffer.from(await doc.save()));
  await page.waitForFunction(() => window.ocrRecoveryAudit.held === 1);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('pre')).toContainText('NATIVE CHECKPOINT');
  await page.getByRole('button', { name: 'Reanudar desde la página 2', exact: true }).click();
  await expect(page.locator('pre')).toContainText('CHECKPOINT OCR', { timeout: 60_000 });
  expect(await page.evaluate(() => window.ocrRecoveryAudit.requests)).toBe(2);
  const output = await texts(await download(page, false));
  expect(output[0].match(/NATIVE CHECKPOINT/g)).toHaveLength(1);
});
