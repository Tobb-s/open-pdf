'use client';

import Link from 'next/link';
import { FileText } from 'lucide-react';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useI18n } from '@/lib/i18n/context';
import { TOOLS } from '@/lib/tools';

export default function Navbar() {
  const { locale, t } = useI18n();

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="flex h-16 items-center justify-between gap-3">
          <Link
            href={`/${locale}`}
            className="flex shrink-0 items-center gap-2 text-xl tracking-tight text-gray-800"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-600">
              <FileText className="h-5 w-5" />
            </div>
            <span className="font-semibold text-gray-900">
              Open<span className="font-normal text-gray-500">PDF</span>
            </span>
          </Link>

          <div className="hidden min-w-0 flex-1 items-center justify-end gap-1 text-sm font-medium lg:flex">
            {TOOLS.map((tool) => (
              <Link
                key={tool.slug}
                href={`/${locale}/${tool.slug}`}
                className="whitespace-nowrap rounded-full px-2.5 py-2 text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
              >
                {t.tools[tool.slug].navLabel}
              </Link>
            ))}
            <Link
              href="https://github.com/Tobb-s/open-pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="whitespace-nowrap rounded-full px-2.5 py-2 text-gray-500 transition-all hover:bg-gray-50 hover:text-gray-900"
            >
              {t.nav.github}
            </Link>
          </div>

          <LanguageSwitcher className="shrink-0" />
        </div>
      </div>
    </nav>
  );
}
