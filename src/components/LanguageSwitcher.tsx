'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Languages } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n/dictionaries';

/**
 * Swaps the language segment of the current path, so switching keeps you on the
 * tool you were using instead of dropping you back at the home page.
 */
function pathInLocale(pathname: string, locale: Locale): string {
  const segments = pathname.split('/').filter(Boolean);
  segments[0] = locale;
  return `/${segments.join('/')}`;
}

export default function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, t } = useI18n();
  const pathname = usePathname() ?? `/${locale}`;

  return (
    <div
      className={cn('flex items-center gap-1 rounded-full bg-gray-100 p-0.5', className)}
      role="group"
      aria-label={t.nav.switchLanguage}
    >
      <Languages className="ml-2 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
      {LOCALES.map((option) => {
        const active = option === locale;
        return (
          <Link
            key={option}
            href={pathInLocale(pathname, option)}
            hrefLang={option}
            aria-current={active ? 'true' : undefined}
            title={LOCALE_NAMES[option]}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors',
              active
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-900'
            )}
          >
            {option}
            <span className="sr-only"> — {LOCALE_NAMES[option]}</span>
          </Link>
        );
      })}
    </div>
  );
}
