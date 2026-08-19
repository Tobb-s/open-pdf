'use client';

import Link from 'next/link';
import { Combine, FileQuestion, FileStack, Minimize2, ScanText } from 'lucide-react';
import Navbar from '@/components/Navbar';
import ToolCard from '@/components/ToolCard';
import { useI18n } from '@/lib/i18n/context';
import { TOOLS, type ToolSlug } from '@/lib/tools';

const SUGGESTED: ToolSlug[] = ['merge', 'split', 'compress', 'ocr'];
const ICONS = {
  merge: Combine,
  split: FileStack,
  compress: Minimize2,
  ocr: ScanText,
} as const;

export default function NotFound() {
  const { locale, t } = useI18n();
  const suggestions = TOOLS.filter((tool) => SUGGESTED.includes(tool.slug));

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-4xl px-6 py-24">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <FileQuestion className="h-8 w-8" />
          </div>
          <h1 className="mb-3 text-4xl font-bold tracking-tight text-gray-900">
            {t.notFound.title}
          </h1>
          <p className="mx-auto mb-10 max-w-md text-gray-500">{t.notFound.body}</p>
        </div>

        <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {suggestions.map((tool) => (
            <ToolCard
              key={tool.slug}
              title={t.tools[tool.slug].title}
              description={t.tools[tool.slug].tagline}
              icon={ICONS[tool.slug as keyof typeof ICONS]}
              href={`/${locale}/${tool.slug}`}
              color={tool.color}
              bgColor={tool.bgColor}
              fullReload={tool.needsFreshDocument}
            />
          ))}
        </div>

        <p className="text-center">
          <Link
            href={`/${locale}`}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            {t.notFound.seeAll}
          </Link>
        </p>
      </main>
    </div>
  );
}
