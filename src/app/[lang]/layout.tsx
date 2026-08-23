import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Geist, Geist_Mono } from 'next/font/google';
import { I18nProvider } from '@/lib/i18n/context';
import { getDictionary, isLocale, LOCALES, type Locale } from '@/lib/i18n/dictionaries';
import '../globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

/**
 * `NEXT_PUBLIC_SITE_URL` lets a fork point canonical URLs and the sitemap at its
 * own domain; the deployed site is the default.
 */
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://open-pdf-omega.vercel.app';

/** Both languages are prerendered, so the site stays a pile of static files. */
export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

/**
 * Anything that is not a locale is a 404 decided by the router, before this
 * layout runs.
 *
 * The `notFound()` below cannot do that job on its own: this file IS the root
 * layout — it renders the html element — and a not-found page is rendered
 * INSIDE the root layout, so a layout that throws leaves nothing to render it
 * in. Next fell back to its built-in error page and the site answered a wrong
 * address with an empty, untitled, English document. Refusing the parameter up
 * here means the request never reaches the layout, and `app/not-found.tsx`
 * renders normally.
 */
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const t = getDictionary(lang);

  return {
    metadataBase: new URL(siteUrl),
    title: { default: t.meta.siteTitle, template: '%s' },
    description: t.meta.siteDescription,
    applicationName: 'OpenPDF',
    alternates: {
      canonical: `/${lang}`,
      // Tells search engines these are the same page in two languages, rather
      // than two pages competing with each other.
      languages: Object.fromEntries([
        ...LOCALES.map((locale) => [locale, `/${locale}`]),
        ['x-default', '/es'],
      ]),
    },
    openGraph: {
      siteName: 'OpenPDF',
      type: 'website',
      locale: lang === 'es' ? 'es_ES' : 'en_US',
      url: `/${lang}`,
      title: t.meta.siteTitle,
      description: t.meta.siteDescription,
    },
    robots: { index: true, follow: true },
  };
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return (
    <html
      lang={lang}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <I18nProvider locale={lang as Locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
