import { beforeEach, describe, expect, it, vi } from 'vitest';
const { configured, session, list } = vi.hoisted(() => ({ configured: vi.fn(), session: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/account/auth', () => ({ accountsAvailable: configured, getAuth: () => ({ getSession: session }),
  accountOwnerId: (sub: string) => `issuer.test:${sub}` }));
vi.mock('@/lib/account/store', () => ({ listProviders: list }));
import { GET } from '@/app/api/account/route';
beforeEach(() => {
  configured.mockReset().mockReturnValue(true); session.mockReset(); list.mockReset().mockResolvedValue([]);
});
describe('authenticated account identity', () => {
  it('exposes only the current account ID and safe profile fields, never tokens or other claims', async () => {
    session.mockResolvedValue({ user: { sub: 'auth0|ownerA', name: 'A', email: 'a@example.invalid', token: 'private-token', roles: ['admin'] } });
    const response = await GET(); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: true, user: { name: 'A', email: 'a@example.invalid', id: 'issuer.test:auth0|ownerA' }, providers: [] });
    expect(list).toHaveBeenCalledWith('issuer.test:auth0|ownerA');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('does not expose an identity or query providers for a guest', async () => {
    session.mockResolvedValue(null);
    expect(await (await GET()).json()).toEqual({ available: true, user: null, providers: [] }); expect(list).not.toHaveBeenCalled();
  });
  it('keeps unconfigured account access independent from authentication and storage', async () => {
    configured.mockReturnValue(false);
    expect(await (await GET()).json()).toEqual({ available: false, user: null, providers: [] });
    expect(session).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  });
  it('redacts authentication and storage errors', async () => {
    session.mockRejectedValue(new Error('private-token'));
    const response = await GET(); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'account_unavailable' });
  });
});
