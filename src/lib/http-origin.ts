/** Proxy can normalize 127.0.0.1 to localhost in request.url. The original Host
 * still identifies the actual browser origin. Never trust forwarded-host input. */
export function isSameOriginRequest(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const url = new URL(request.url), source = new URL(origin);
    const expected = new URL(`${url.protocol}//${request.headers.get('host') ?? url.host}`);
    if (expected.username || expected.password || expected.pathname !== '/' || expected.search || expected.hash) return false;
    return source.origin === origin && source.origin === expected.origin;
  } catch { return false; }
}
