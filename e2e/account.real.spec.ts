import { randomBytes } from 'node:crypto';
import * as nextEnv from '@next/env';
import { neon } from '@neondatabase/serverless';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

test('real login, persistent provider isolation, foreign-ID rejection and logout', async ({ browser }) => {
  test.skip(process.env.OPENPDF_REAL_ACCOUNT_TEST !== '1', 'Opt-in: provisions disposable users in the development Auth0 tenant.');
  test.setTimeout(120_000);
  nextEnv.loadEnvConfig(process.cwd(), true);
  const host = process.env.AUTH0_DOMAIN!;
  if (!host.includes('-development.')) throw new Error('Real account tests require the development Auth0 tenant');
  const tokenResponse = await fetch(`https://${host}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ client_id: process.env.AUTH0_MANAGEMENT_API_CLIENT_ID, client_secret: process.env.AUTH0_MANAGEMENT_API_CLIENT_SECRET,
      audience: `https://${host}/api/v2/`, grant_type: 'client_credentials' }),
  });
  expect(tokenResponse.ok).toBe(true);
  const { access_token: token } = await tokenResponse.json();
  async function management(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(`https://${host}/api/v2/${path}`, { method,
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`Account fixture operation failed (${response.status})`);
    return response.status === 204 ? null : response.json();
  }
  const suffix = randomBytes(6).toString('hex'), password = `${randomBytes(20).toString('hex')}Aa1!`;
  const users: { email: string; user_id: string }[] = [], contexts: BrowserContext[] = [];
  const sql = neon(process.env.DATABASE_URL!);
  try {
    for (const owner of ['a', 'b']) {
      users.push(await management('users', 'POST', { connection: 'Username-Password-Authentication',
        email: `openpdf-test-${suffix}-${owner}@example.invalid`, password, email_verified: true, verify_email: false }));
    }
    async function login(page: Page, email: string) {
      await page.goto('/es/account');
      await page.getByRole('link', { name: 'Entrar', exact: true }).click();
      await page.locator('input[name=username]').fill(email);
      await page.locator('input[name=password]').fill(password);
      await page.getByRole('button', { name: /Continuar|Continue|Iniciar sesión|Log in|Sign in/, exact: true }).click({ timeout: 15_000 });
      await expect(page).toHaveURL(/\/es\/account/, { timeout: 25_000 });
      await expect(page.getByRole('heading', { name: 'Mis proveedores' })).toBeVisible();
    }
    const a = await browser.newContext(), b = await browser.newContext(); contexts.push(a, b);
    const pageA = await a.newPage(), pageB = await b.newPage();
    async function appRequest(page: Page, path: string, method = 'GET', data?: unknown, headers?: Record<string, string>) {
      return page.evaluate(async ({ path, method, data, headers }) => {
        const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...headers },
          ...(data ? { body: JSON.stringify(data) } : {}) });
        return { status: response.status, data: response.status === 204 ? null : await response.json() };
      }, { path, method, data, headers });
    }
    await login(pageA, users[0].email); await login(pageB, users[1].email);
    const secretA = `test-key-A-${suffix}`, secretB = `test-key-B-${suffix}`;
    async function save(page: Page, label: string, apiKey: string) {
      await page.getByLabel('Nombre para reconocerlo').fill(label); await page.getByLabel('Clave API', { exact: true }).fill(apiKey);
      const saving = page.waitForResponse(response => response.url().endsWith('/api/account/providers') && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Guardar proveedor' }).click();
      const saved = await saving;
      if (saved.status() !== 201) throw new Error(`Provider save failed (${saved.status()}, ${(await saved.json()).error})`);
      await expect(page.getByText('Proveedor guardado. Ya podés elegirlo al traducir.')).toBeVisible();
      const response = await appRequest(page, '/api/account'); const data = response.data;
      expect(response.status).toBe(200);
      expect(data.user).not.toBeNull();
      expect(data.providers).toHaveLength(1);
      expect(JSON.stringify(data)).not.toContain(apiKey); return data.providers[0];
    }
    const providerA = await save(pageA, 'Cuenta A', secretA), providerB = await save(pageB, 'Cuenta B', secretB);
    expect(providerA.id).not.toBe(providerB.id);
    await pageA.reload(); await expect(pageA.getByText('Cuenta A', { exact: true })).toBeVisible();
    await expect(pageA.getByText('Cuenta B', { exact: true })).toHaveCount(0);
    await expect(pageB.getByText('Cuenta A', { exact: true })).toHaveCount(0);
    const payload = { provider: 'openai', model: 'gpt-4.1-mini', glossary: '', consent: true, segments: [{ id: 'x', text: 'Hello' }] };
    const foreign = await appRequest(pageB, '/api/translate', 'POST', payload, { 'X-OpenPDF-Provider': providerA.id });
    expect(foreign.status).toBe(404); expect(foreign.data).toEqual({ error: 'provider_not_found' });
    expect((await appRequest(pageB, '/api/account/providers', 'DELETE', { id: providerA.id })).status).toBe(404);
    await pageA.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await expect(pageA.getByText('Todavía no guardaste ningún proveedor.')).toBeVisible();
    expect((await appRequest(pageB, '/api/account')).data.providers).toHaveLength(1);
    await pageA.getByRole('link', { name: 'Cerrar sesión' }).click();
    await pageA.goto('/es/account'); await expect(pageA.getByRole('link', { name: 'Entrar', exact: true })).toBeVisible();
    const expired = await appRequest(pageA, '/api/translate', 'POST', payload, { 'X-OpenPDF-Provider': providerB.id });
    expect(expired.status).toBe(401);
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
    for (const user of users) {
      const owner = `${host}:${user.user_id}`;
      await sql`DELETE FROM openpdf_provider_credentials WHERE owner_id = ${owner}`;
      await management(`users/${encodeURIComponent(user.user_id)}`, 'DELETE');
    }
  }
});
