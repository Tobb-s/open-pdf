import { describe, expect, it } from 'vitest';
import { isSameOriginRequest } from '@/lib/http-origin';
function req(origin?: string, headers: Record<string, string> = {}, url = 'https://openpdf.test/api/account/providers') {
  return new Request(url, { headers: { ...(origin ? { origin } : {}), ...headers } });
}
describe('same-origin requests through Next proxy', () => {
  it('uses the original Host when proxy normalizes loopback in request.url', () => {
    expect(isSameOriginRequest(req('http://127.0.0.1:3000', { host: '127.0.0.1:3000' }, 'http://localhost:3000/api/account/providers'))).toBe(true);
  });
  it('accepts exact HTTPS origins with or without Host', () => {
    expect(isSameOriginRequest(req('https://openpdf.test'))).toBe(true);
    expect(isSameOriginRequest(req('https://openpdf.test', { host: 'openpdf.test' }))).toBe(true);
  });
  it.each([undefined, 'null', 'https://evil.test', 'http://openpdf.test', 'https://openpdf.test/', 'https://openpdf.test?x=1'])('rejects foreign or malformed origin %s', origin => {
    expect(isSameOriginRequest(req(origin))).toBe(false);
  });
  it('does not trust forwarded hosts or inconsistent original hosts', () => {
    expect(isSameOriginRequest(req('https://evil.test', { 'x-forwarded-host': 'evil.test' }))).toBe(false);
    expect(isSameOriginRequest(req('https://openpdf.test', { host: 'evil.test' }))).toBe(false);
    expect(isSameOriginRequest(req('https://openpdf.test', { host: 'user@openpdf.test' }))).toBe(false);
    expect(isSameOriginRequest(req('https://openpdf.test', { 'sec-fetch-site': 'cross-site' }))).toBe(false);
  });
});
