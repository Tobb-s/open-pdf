import type { MetadataRoute } from 'next';
import { siteUrl } from '@/app/layout';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: '/vendor/' }],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
