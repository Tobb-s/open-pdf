'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Search } from 'lucide-react';
import GitHubMark from '@/components/GitHubMark';
import Navbar from '@/components/Navbar';
import ToolCard from '@/components/ToolCard';
import { useI18n } from '@/lib/i18n/context';
import { STUDIO, TOOLBOX, TOOLS } from '@/lib/tools';
import { TOOL_ICONS } from '@/lib/toolIcons';

/**
 * The front page.
 *
 * Two families, each in its own container, rather than thirteen equal cards.
 * OpenPDF Studio is the editor and gets a card of its own, in its colour, with
 * its button; OpenPDF Tools is the box the single-task tools live in.
 * The search in the hero flattens all of that into results the moment the
 * reader types — browsing is structured, searching is not.
 */

const REPO_URL = 'https://github.com/Tobb-s/open-pdf';
const StudioIcon = TOOL_ICONS[STUDIO];

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

  const needle = query.trim().toLowerCase();
  const searching = needle !== '';

  const results = useMemo(() => {
    if (!searching) return [];
    return TOOLS.filter((tool) => {
      const copy = t.tools[tool.slug];
      return `${copy.title} ${copy.tagline} ${copy.keywords.join(' ')}`
        .toLowerCase()
        .includes(needle);
    });
  }, [needle, searching, t]);

  const card = (tool: (typeof TOOLS)[number]) => (
    <ToolCard
      key={tool.slug}
      title={t.tools[tool.slug].title}
      description={t.tools[tool.slug].tagline}
      icon={TOOL_ICONS[tool.slug]}
      href={`/${locale}/${tool.slug}`}
      color={tool.color}
      bgColor={tool.bgColor}
      fullReload={tool.needsFreshDocument}
    />
  );

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

        {searching ? (
          /* Searching flattens both families into one list of matches. */
          <section className="pb-24" aria-live="polite">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.length > 0 ? (
                results.map(card)
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
        ) : (
          <>
            {/* The editor: one product, in its own colour, with its own door. */}
            <section className="pb-6" aria-labelledby="studio-heading">
              <div className="flex flex-col gap-6 rounded-3xl border border-violet-100 bg-violet-50 p-6 sm:flex-row sm:items-center sm:p-8">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-violet-600 shadow-sm">
                  <StudioIcon className="h-7 w-7" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2
                    id="studio-heading"
                    className="text-2xl font-semibold tracking-tight text-gray-900"
                  >
                    {t.home.studioName}
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-gray-600 sm:text-base">
                    {t.home.studioBody}
                  </p>
                </div>
                <Link
                  href={`/${locale}/${STUDIO}`}
                  className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 sm:self-center"
                >
                  {t.home.openStudio}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </section>

            {/* The toolbox: single-task tools inside the thing that holds them. */}
            <section id="tools" className="scroll-mt-24 pb-24" aria-labelledby="tools-heading">
              <div className="rounded-3xl border border-gray-100 bg-gray-50 p-6 sm:p-8">
                <div className="mb-6">
                  <h2
                    id="tools-heading"
                    className="text-2xl font-semibold tracking-tight text-gray-900"
                  >
                    {t.home.toolsName}
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-500 sm:text-base">
                    {t.home.toolsBody}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {TOOLBOX.map(card)}
                </div>
              </div>
            </section>
          </>
        )}

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
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col items-center gap-2"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-50 transition-colors group-hover:bg-gray-100">
                  <GitHubMark className="text-gray-600" />
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
            href={REPO_URL}
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
