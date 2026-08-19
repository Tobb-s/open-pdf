import type { NextConfig } from 'next';

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
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
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

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
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
        source:
          '/:slug(compress|ocr|merge|split|organize|pdf-to-word|edit|fill-form|image-pdf)',
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
        // The vendored engines are content-addressed by the lockfile and change
        // only when a dependency does.
        source: '/vendor/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
