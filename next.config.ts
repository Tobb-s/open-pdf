import type { NextConfig } from 'next';
import { TOOL_SLUGS } from './src/lib/tools';

/**
 * Nothing executable is loaded from another origin — the PDF and OCR engines are
 * copied into `public/vendor` at build time — so the policy can simply say so.
 *
 * `wasm-unsafe-eval` is required to instantiate the WebAssembly the PDF and OCR
 * engines are compiled to. `blob:` covers the workers and object URLs the tools
 * create for themselves; `connect-src 'self' blob: data:` lets them read those
 * back. There is no `unsafe-eval` and no remote origin anywhere in the policy.
 *
 * `script-src` allows inline scripts, which is a deliberate trade. Next.js boots
 * React from inline bootstrap scripts; the alternatives are a per-request nonce,
 * which requires middleware and would turn every page into a server-rendered one,
 * or build-time hashes, which change with every build. Keeping the site a pile of
 * static files is the thing the privacy claim rests on, so it wins here.
 *
 * What that concession costs is small for this app: there is no `innerHTML`, no
 * `dangerouslySetInnerHTML` and no `eval` anywhere in the source, so there is no
 * sink to inject into. And the directives that would matter if there were one are
 * still shut: `connect-src`, `img-src` and `form-action` are all limited to this
 * origin, so injected code has nowhere to send a document.
 */
function contentSecurityPolicy({ allowOfficeEngine = false } = {}) {
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    // What LibreOffice needs beyond the usual policy: its Emscripten loader
    // evaluates strings, and zetajs bootstraps its worker from a data: URL.
    ...(allowOfficeEngine ? ["'unsafe-eval'", 'data:'] : []),
  ].join(' ');

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Next.js injects its critical CSS inline.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "connect-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // A tool that handles private documents should never be framed by anyone.
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** The route that runs LibreOffice. Its policy is relaxed; nothing else's is. */
const OFFICE_ROUTE = 'office-to-pdf';

const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/**
 * The LibreOffice engine runs on WebAssembly threads, which need
 * SharedArrayBuffer, which the browser only grants to a cross-origin isolated
 * document. Isolation is scoped to the converter route: applying it site-wide
 * would put the other nine tools at risk for a feature they do not use.
 *
 * It is only viable at all because the audit removed every third-party asset —
 * `require-corp` would block any cross-origin subresource, and there are none
 * left. `next/font/google` self-hosts its fonts at build time.
 */
const ISOLATION_HEADERS = [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
  // Emscripten's loader evaluates strings, so LibreOffice cannot start under the
  // site's usual policy. The concession is real but contained: it applies to this
  // one route, every byte it runs is served from this origin, and `connect-src`,
  // `img-src` and `form-action` stay locked to 'self' — so even code that did get
  // in would have nowhere to send a document.
  { key: 'Content-Security-Policy', value: contentSecurityPolicy({ allowOfficeEngine: true }) },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  async redirects() {
    return [
      // Spanish is the default. A visitor who lands on the bare domain, or on a
      // tool path without a language, gets the Spanish version; the switcher in
      // the header takes them to English and keeps them on the same tool.
      { source: '/', destination: '/es', permanent: false },
      {
        // Derived from the catalogue rather than written out again: the
        // hand-kept copy of this list was missing watermark, page-numbers and
        // studio, so those three 404'd on their language-less URL while the
        // other ten redirected. `tools.ts` imports nothing, so pulling it in
        // here is safe.
        source: `/:slug(${TOOL_SLUGS.join('|')})`,
        destination: '/es/:slug',
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
      {
        // Everything except the converter gets the strict policy. Expressed as an
        // exclusion so that exactly one Content-Security-Policy header is ever
        // sent: two headers are intersected by the browser, which would silently
        // undo the relaxation below.
        source: `/((?!(?:es|en)/${OFFICE_ROUTE}$).*)`,
        headers: [{ key: 'Content-Security-Policy', value: contentSecurityPolicy() }],
      },
      {
        source: `/:lang(es|en)/${OFFICE_ROUTE}`,
        headers: ISOLATION_HEADERS,
      },
      {
        // The vendored engines change only when someone changes them on
        // purpose: the ones from npm are pinned by the lockfile, and the
        // LibreOffice build — which is not on npm, and comes from a mutable
        // `latest` URL — is pinned by sha256 in scripts/vendor-assets.mjs,
        // which refuses to install anything else. Without that second half
        // this immutable, year-long cache would strand recurring visitors on
        // whichever bytes that URL happened to serve.
        source: '/vendor/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          // Lets the isolated converter page load them.
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
      {
        // Emscripten's packed filesystem has no extension the CDN recognises, so
        // without this it would be served uncompressed — 95 MB instead of 15.
        source: '/vendor/lowa/soffice.data',
        headers: [{ key: 'Content-Type', value: 'application/wasm' }],
      },
    ];
  },
};

export default nextConfig;
