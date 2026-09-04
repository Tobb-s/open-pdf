import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function samplePdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  const page = document.addPage([420, 594]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('OpenPDF browser check', {
    x: 48,
    y: 520,
    size: 18,
    font,
    color: rgb(0.2, 0.15, 0.5),
  });
  return Buffer.from(await document.save());
}

test('Studio loads a PDF and exposes working zoom controls', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto('/es/studio');
  await expect(page.getByRole('heading', { name: 'OpenPDF Studio' })).toBeVisible();

  await page.locator('#studio-file-input').setInputFiles({
    name: 'browser-check.pdf',
    mimeType: 'application/pdf',
    buffer: await samplePdf(),
  });

  await expect(page.getByText('browser-check.pdf')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportar' })).toBeVisible();
  await expect(page.locator('output')).toHaveText('100%');

  await page.getByRole('button', { name: 'Acercar' }).click();
  await expect(page.locator('output')).toHaveText('125%');
  await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test('Office isolation is limited to the converter route', async ({ page }) => {
  const studio = await page.request.get('/es/studio');
  const studioHeaders = studio.headers();
  const studioPolicy = studioHeaders['content-security-policy'] ?? '';

  expect(studio.ok()).toBe(true);
  expect(studioPolicy).toContain("default-src 'self'");
  expect(studioPolicy).not.toMatch(/(?:^|\s)'unsafe-eval'(?:\s|;|$)/);
  expect(studioHeaders['cross-origin-embedder-policy']).toBeUndefined();

  const office = await page.goto('/es/office-to-pdf');
  const officeHeaders = office?.headers() ?? {};
  const officePolicy = officeHeaders['content-security-policy'] ?? '';

  expect(office?.ok()).toBe(true);
  expect(officeHeaders['cross-origin-opener-policy']).toBe('same-origin');
  expect(officeHeaders['cross-origin-embedder-policy']).toBe('require-corp');
  expect(officeHeaders['x-frame-options']).toBe('DENY');
  expect(officePolicy).toMatch(/(?:^|\s)'unsafe-eval'(?:\s|;|$)/);
  await expect(page.getByRole('heading', { name: 'PPT y Word a PDF' })).toBeVisible();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
});
