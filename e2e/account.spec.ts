import { test, expect } from '@playwright/test';

const provider = { id: '12345678-1234-1234-1234-123456789abc', label: 'Mi OpenAI', provider: 'openai', model: 'gpt-4.1-mini', keyHint: '••••1234' };
test('guest account page offers sign-in and registration without exposing providers', async ({ page }) => {
  await page.route('**/api/account', route => route.fulfill({ json: { available: true, user: null, providers: [] } }));
  await page.goto('/es/account');
  await expect(page.getByRole('link', { name: 'Entrar', exact: true })).toHaveAttribute('href', /\/auth\/login\?/);
  await expect(page.getByRole('link', { name: 'Crear cuenta', exact: true })).toHaveAttribute('href', /screen_hint=signup/);
  await expect(page.getByLabel('Clave API', { exact: true })).toHaveCount(0);
});
test('saved provider selection never puts a stored key in browser input or storage', async ({ page }) => {
  await page.route('**/api/account', route => route.fulfill({ json: { available: true, user: { name: 'Cuenta de prueba' }, providers: [provider] } }));
  await page.goto('/es/translate');
  await page.getByLabel('Clave para esta traducción').selectOption(provider.id);
  await expect(page.getByText('Usando tu proveedor guardado: Mi OpenAI')).toBeVisible();
  await expect(page.getByLabel('Modelo', { exact: true })).toBeDisabled();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
    .toEqual({ local: [], session: [] });
  await page.getByLabel('Clave para esta traducción').selectOption('');
  await expect(page.locator('input[type=password]')).toHaveValue('');
});
test('saving clears the typed key and lists only masked metadata', async ({ page }) => {
  let saved = false;
  await page.route('**/api/account', route => route.fulfill({ json: { available: true, user: { name: 'Cuenta de prueba' }, providers: saved ? [provider] : [] } }));
  await page.route('**/api/account/providers', async route => {
    expect(route.request().postDataJSON().apiKey).toBe('synthetic-test-key-1234');
    saved = true; await route.fulfill({ status: 201, json: provider });
  });
  await page.goto('/es/account');
  await page.getByLabel('Nombre para reconocerlo').fill('Mi OpenAI');
  await page.getByLabel('Clave API', { exact: true }).fill('synthetic-test-key-1234');
  await page.getByRole('button', { name: 'Guardar proveedor' }).click();
  await expect(page.getByText('Proveedor guardado. Ya podés elegirlo al traducir.')).toBeVisible();
  await expect(page.getByLabel('Clave API', { exact: true })).toHaveValue('');
  await expect(page.getByText('openai · gpt-4.1-mini · ••••1234')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('synthetic-test-key-1234');
});
test('mobile navigation keeps the personal account accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/es');
  await expect(page.getByRole('link', { name: 'Mi cuenta' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
