'use client';

import { usePathname } from 'next/navigation';
import { Geist, Geist_Mono } from 'next/font/google';
import NotFoundContent from '@/components/NotFoundContent';
import { I18nProvider } from '@/lib/i18n/context';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/dictionaries';
import './globals.css';

/**
 * The 404 the site actually serves.
 *
 * `[lang]/layout.tsx` is the root layout — it is what renders `<html>` — and it
 * is also what calls `notFound()` when the first path segment is not a locale.
 * A layout's own error cannot be caught by a boundary beneath it, so
 * `[lang]/not-found.tsx` never rendered for that case and production returned
 * Next's built-in page: an empty document, in English, with no title. The
 * hand-written page kept being edited on the assumption it was being shipped.
 *
 * Because this stands in for the root layout, it has to bring the shell with
 * it: the html and body elements, the fonts, the stylesheet, and the i18n
 * provider the content expects.
 *
 * One honest limit. The locale is read from the path, and at prerender time
 * there is no path — this page is built once — so the HTML that ships is in the
 * default language and only becomes English once it hydrates. A catch-all under
 * [lang] would know the language, but the layout above refuses unknown params
 * so that a bad LANGUAGE never reaches it, and a dynamic route under that
 * refusal has no fallback to render: Next answers with its own error page,
 * which is worse than the wrong language on a page nobody indexes.
 */

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

function localeFromPath(pathname: string | null): Locale {
  const first = (pathname ?? '').split('/').filter(Boolean)[0];
  return first !== undefined && isLocale(first) ? first : DEFAULT_LOCALE;
}

export default function NotFound() {
  const locale = localeFromPath(usePathname());

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <I18nProvider locale={locale}>
          <NotFoundContent />
        </I18nProvider>
      </body>
    </html>
  );
}
