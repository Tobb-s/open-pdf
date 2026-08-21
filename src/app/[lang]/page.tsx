'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Combine,
  FileStack,
  FileType,
  FormInput,
  Hash,
  Image as ImageIcon,
  Minimize2,
  PenSquare,
  Presentation,
  ScanText,
  Search,
  Split,
  Stamp,
  type LucideIcon,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import ToolCard from '@/components/ToolCard';
import { useI18n } from '@/lib/i18n/context';
import { TOOLS, type ToolSlug } from '@/lib/tools';

/** Typed by slug, so adding a tool without an icon fails to compile. */
const ICONS: Record<ToolSlug, LucideIcon> = {
  compress: Minimize2,
  ocr: ScanText,
  merge: Combine,
  split: Split,
  organize: FileStack,
  'pdf-to-word': FileType,
  edit: PenSquare,
  'fill-form': FormInput,
  'office-to-pdf': Presentation,
  'image-pdf': ImageIcon,
  watermark: Stamp,
  'page-numbers': Hash,
};

export default function Home() {
  const { locale, t } = useI18n();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return TOOLS;
    return TOOLS.filter((tool) => {
      const copy = t.tools[tool.slug];
      return `${copy.title} ${copy.tagline} ${copy.keywords.join(' ')}`
        .toLowerCase()
        .includes(needle);
    });
  }, [query, t]);

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-5xl px-6 sm:px-8">
        <section className="pb-16 pt-24 text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-4 py-1.5 text-sm font-medium text-blue-700">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            {t.home.badge}
          </div>
          <h1 className="mb-5 text-balance text-5xl font-medium leading-tight tracking-tight text-gray-900 sm:text-6xl">
            {t.home.headingLine1}
            <br />
            <span className="font-semibold">{t.home.headingLine2}</span>
          </h1>
          <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed text-gray-500">
            {t.home.intro}
          </p>

          <div className="relative mx-auto max-w-lg">
            <div className="flex items-center rounded-full border border-gray-200 bg-white py-2 pl-5 pr-2 shadow-sm transition-all focus-within:border-blue-400 focus-within:shadow-md hover:border-gray-300">
              <Search className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
              <label className="sr-only" htmlFor="tool-search">
                {t.home.searchLabel}
              </label>
              <input
                ref={searchRef}
                id="tool-search"
                type="search"
                placeholder={t.home.searchPlaceholder}
                className="flex-1 bg-transparent px-3 py-2 text-sm text-gray-700 placeholder-gray-400 outline-none"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <kbd className="hidden items-center rounded-md border bg-gray-50 px-2 py-1 font-mono text-xs text-gray-400 sm:inline-flex">
                Ctrl+K
              </kbd>
            </div>
          </div>
        </section>

        <section className="pb-24">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.length > 0 ? (
              filtered.map((tool) => (
                <ToolCard
                  key={tool.slug}
                  title={t.tools[tool.slug].title}
                  description={t.tools[tool.slug].tagline}
                  icon={ICONS[tool.slug]}
                  href={`/${locale}/${tool.slug}`}
                  color={tool.color}
                  bgColor={tool.bgColor}
                  fullReload={tool.needsFreshDocument}
                />
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-200 py-12 text-center sm:col-span-2 lg:col-span-3">
                <p className="text-sm text-gray-500">{t.home.noMatches(query.trim())}</p>
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  {t.home.clearSearch}
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="pb-24">
          <div className="rounded-3xl border border-gray-100 bg-gray-50 p-10 text-center sm:p-14">
            <div className="mb-8 flex justify-center gap-10">
              <div className="flex flex-col items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50">
                  <svg
                    className="h-5 w-5 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                </div>
                <span className="text-sm font-medium text-gray-700">{t.home.private}</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
                  <svg
                    className="h-5 w-5 text-blue-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                </div>
                <span className="text-sm font-medium text-gray-700">{t.home.fast}</span>
              </div>
              <Link
                href="https://github.com/Tobb-s/open-pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col items-center gap-2"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-50 transition-colors group-hover:bg-gray-100">
                  <svg
                    className="h-5 w-5 text-gray-600"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-gray-700">{t.home.openSource}</span>
              </Link>
            </div>
            <h2 className="mb-3 text-2xl font-medium text-gray-900">{t.home.whyTitle}</h2>
            <p className="mx-auto max-w-2xl text-sm leading-relaxed text-gray-500">
              {t.home.whyBody}
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-100 py-8 text-center text-sm text-gray-400">
        <p>
          {t.home.footer}{' '}
          <Link
            href="https://github.com/Tobb-s/open-pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-gray-300 underline-offset-4 hover:text-gray-600"
          >
            {t.home.readCode}
          </Link>
          .
        </p>
      </footer>
    </div>
  );
}
