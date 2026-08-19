import type { MetadataRoute } from 'next';
import { siteUrl } from '@/app/layout';
import { TOOLS } from '@/lib/tools';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl, changeFrequency: 'monthly', priority: 1 },
    ...TOOLS.map((tool) => ({
      url: `${siteUrl}/${tool.slug}`,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ];
}
