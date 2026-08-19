import type { MetadataRoute } from 'next';
import { siteUrl } from '@/app/[lang]/layout';
import { LOCALES } from '@/lib/i18n/dictionaries';
import { TOOL_SLUGS } from '@/lib/tools';

/**
 * Every page in every language, each entry listing its translations so search
 * engines treat them as one page rather than as competitors.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const alternates = (path: string) => ({
    languages: Object.fromEntries(LOCALES.map((locale) => [locale, `${siteUrl}/${locale}${path}`])),
  });

  return LOCALES.flatMap((locale) => [
    {
      url: `${siteUrl}/${locale}`,
      changeFrequency: 'monthly' as const,
      priority: 1,
      alternates: alternates(''),
    },
    ...TOOL_SLUGS.map((slug) => ({
      url: `${siteUrl}/${locale}/${slug}`,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
      alternates: alternates(`/${slug}`),
    })),
  ]);
}
