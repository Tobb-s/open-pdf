import { test, expect } from '@playwright/test';
const id = '12345678-1234-1234-1234-123456789abc';
const models = [{ id: 'gpt-6-luna', kind: 'text' }, { id: 'gpt-6-sol', kind: 'text' }, { id: 'gpt-image-2', kind: 'specialized' }];
test('saved key catalog uses only its ID; complete catalog, model choice and consent reset', async ({ page }) => {
  await page.route('**/api/account', route => route.fulfill({ json: { available: true, user: { name: 'Test' }, providers: [
    { id, label: 'Mi OpenAI', provider: 'openai', model: 'gpt-6-luna', keyHint: '••••1234' },
  ] } }));
  let calls = 0;
  await page.route('**/api/models', async route => {
    calls++; expect(route.request().headers()['x-openpdf-provider']).toBe(id);
    expect(route.request().headers().authorization).toBeUndefined();
    expect(route.request().postDataJSON()).toEqual({ provider: 'openai' });
    await route.fulfill({ json: { models } });
  });
  await page.goto('/es/translate');
  await expect(page.getByLabel('Modelo', { exact: true })).toHaveValue('gpt-6-luna');
  await page.getByLabel('Clave para esta traducción').selectOption(id);
  await page.getByRole('button', { name: 'Consultar modelos de mi API' }).click();
  await expect(page.getByText('3 modelos disponibles en el catálogo')).toBeVisible();
  await expect(page.getByRole('option', { name: /gpt-image-2/ })).toHaveAttribute('disabled', '');
  await page.getByLabel(/Autorizo enviar los textos/).check();
  await page.getByLabel('Elegir del catálogo', { exact: true }).selectOption('gpt-6-sol');
  await expect(page.getByLabel('Modelo', { exact: true })).toHaveValue('gpt-6-sol');
  await expect(page.getByLabel(/Autorizo enviar los textos/)).not.toBeChecked();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.getByLabel('Clave para esta traducción').selectOption('');
  await expect(page.getByText('3 modelos disponibles en el catálogo')).toHaveCount(0);
  expect(calls).toBe(1);
});
test('temporary key catalog failure preserves manual model and allows an explicit retry without auto retries', async ({ page }) => {
  await page.route('**/api/account', route => route.fulfill({ json: { available: true, user: null, providers: [] } }));
  let calls = 0;
  await page.route('**/api/models', async route => {
    calls++; expect(route.request().headers().authorization).toBe('Bearer synthetic-key-1234');
    await route.fulfill(calls === 1 ? { status: 502, json: { error: 'provider_auth' } } : { json: { models } });
  });
  await page.goto('/es/translate');
  await page.locator('input[type=password]').fill('synthetic-key-1234');
  await page.getByLabel('Modelo', { exact: true }).fill('manual-future-model');
  await page.getByRole('button', { name: 'Consultar modelos de mi API' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'No pudimos consultar el catálogo' })).toBeVisible();
  await expect(page.getByLabel('Modelo', { exact: true })).toHaveValue('manual-future-model');
  expect(calls).toBe(1);
  await page.getByRole('button', { name: 'Consultar modelos de mi API' }).click();
  await expect(page.getByText('3 modelos disponibles en el catálogo')).toBeVisible(); expect(calls).toBe(2);
  await page.locator('input[type=password]').fill('changed-key-5678');
  await expect(page.getByLabel('Elegir del catálogo', { exact: true })).toHaveCount(0);
});
