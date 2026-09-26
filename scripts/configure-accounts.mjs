import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Run after pulling the three environments into ignored .env.*.local files.
// No secrets, bearer tokens or provider responses are printed.
const environments = ['development', 'production', 'preview'].map(name => ({ name,
  env: parseEnv(readFileSync(`.env.${name}.local`, 'utf8')),
}));
for (const { name, env } of environments) {
if (env.AUTH0_MANAGEMENT_API_CLIENT_ID?.startsWith('only-set-in-')) {
  console.log(`${name}: Auth0 settings are managed by the Vercel integration. Verify the email/password connection and callback URLs in its dashboard.`);
  continue;
}
const host = env.AUTH0_DOMAIN;
const tokenResponse = await fetch(`https://${host}/oauth/token`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    client_id: env.AUTH0_MANAGEMENT_API_CLIENT_ID, client_secret: env.AUTH0_MANAGEMENT_API_CLIENT_SECRET,
    audience: `https://${host}/api/v2/`, grant_type: 'client_credentials',
  }),
});
if (!tokenResponse.ok) {
  if (name === 'preview') { console.log('Preview management credentials require separate setup; production and local login remain configured.'); continue; }
  throw new Error(`Management authentication failed (${tokenResponse.status})`);
}
const { access_token: token } = await tokenResponse.json();
async function api(path, body) {
  const response = await fetch(`https://${host}/api/v2/${path}`, {
    method: body ? 'PATCH' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Account configuration failed (${response.status})`);
  return response.status === 204 ? null : response.json();
}
const connections = await api('connections');
const passwords = connections.find(c => c.name === 'Username-Password-Authentication' && c.strategy === 'auth0');
if (!passwords) throw new Error('Password connection missing');
  if (!env.AUTH0_CLIENT_ID) throw new Error('Missing auth client');
  const id = env.AUTH0_CLIENT_ID;
  const client = await api(`clients/${id}`);
  const origins = name === 'development' ? ['http://localhost:3000', 'http://127.0.0.1:3000']
    : ['https://open-pdf-omega.vercel.app', 'https://open-pdf-tobbs1.vercel.app'];
  await api(`clients/${id}`, {
    name: `OpenPDF (${name})`, app_type: 'regular_web',
    callbacks: [...new Set([...(client.callbacks ?? []), ...origins.map(o => `${o}/auth/callback`)])],
    allowed_logout_urls: [...new Set([...(client.allowed_logout_urls ?? []), ...origins.flatMap(o => [o, `${o}/`, `${o}/es/account`, `${o}/en/account`])])],
  });
  await api(`connections/${passwords.id}/clients`, [{ client_id: id, status: true }]);
  console.log(`Email/password login configured: ${name}`);
await api('tenants/settings', { friendly_name: 'OpenPDF', enabled_locales: ['es', 'en'] });
}
console.log('Account setup complete. Google OAuth and production email delivery require their own provider configuration.');
