import type { Metadata } from 'next';
import { getDictionary, isLocale, LOCALES } from '@/lib/i18n/dictionaries';
import type { ToolSlug } from '@/lib/tools';

/** Page metadata for one tool in one language, with links to its translations. */
export function toolMetadata(slug: ToolSlug, lang: string): Metadata {
  if (!isLocale(lang)) return {};

  const t = getDictionary(lang);
  const tool = t.tools[slug];
  const title = `${tool.title} — ${t.meta.titleSuffix}`;

  return {
    title,
    description: tool.description,
    alternates: {
      canonical: `/${lang}/${slug}`,
      languages: Object.fromEntries([
        ...LOCALES.map((locale) => [locale, `/${locale}/${slug}`]),
        ['x-default', `/es/${slug}`],
      ]),
    },
    openGraph: {
      title: `${tool.title} | OpenPDF`,
      description: tool.description,
      url: `/${lang}/${slug}`,
      type: 'website',
      locale: lang === 'es' ? 'es_ES' : 'en_US',
    },
  };
}
