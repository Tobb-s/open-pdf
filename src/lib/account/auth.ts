import 'server-only';
import { Auth0Client } from '@auth0/nextjs-auth0/server';
import { TranslationError } from '@/lib/translation/contracts';

let client: Auth0Client | undefined;
export function accountsAvailable() {
  return !!(process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID && process.env.AUTH0_CLIENT_SECRET &&
    process.env.AUTH0_SECRET && process.env.DATABASE_URL && process.env.ACCOUNT_VAULT_KEY);
}
export function getAuth() {
  if (!accountsAvailable()) throw new TranslationError('account_unavailable', 503);
  return client ??= new Auth0Client({
    enableAccessTokenEndpoint: false,
    authorizationParameters: { scope: 'openid profile email', connection: 'Username-Password-Authentication' },
    signInReturnToPath: '/es/account',
    session: { rolling: true, inactivityDuration: 60 * 60 * 24, absoluteDuration: 60 * 60 * 24 * 7 },
  });
}
export async function requireAccount() {
  const session = await getAuth().getSession();
  if (!session?.user?.sub) throw new TranslationError('login_required', 401);
  return { ...session.user, ownerId: accountOwnerId(session.user.sub) };
}
export function accountOwnerId(sub: string) { return `${process.env.AUTH0_DOMAIN}:${sub}`; }
