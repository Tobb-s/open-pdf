import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

/**
 * `NEXT_PUBLIC_SITE_URL` lets a fork point canonical URLs and the sitemap at its
 * own domain; the deployed site is the default.
 */
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://open-pdf-omega.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'OpenPDF — PDF tools that run in your browser',
    template: '%s',
  },
  description:
    'Free, open-source PDF tools. Merge, split, compress, OCR, edit and fill PDF forms without uploading anything: every tool runs in your browser.',
  applicationName: 'OpenPDF',
  alternates: { canonical: '/' },
  openGraph: {
    siteName: 'OpenPDF',
    type: 'website',
    url: '/',
    title: 'OpenPDF — PDF tools that run in your browser',
    description:
      'Merge, split, compress, OCR, edit and fill PDF forms without uploading anything. Free and open source.',
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
