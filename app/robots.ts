import type { MetadataRoute } from 'next';
import { getCanonicalOrigin } from '../lib/seo/schema';

export default function robots(): MetadataRoute.Robots {
  const origin = getCanonicalOrigin();

  return {
    rules: [
      // Search Indexers
      {
        userAgent: ['Googlebot', 'Bingbot', 'Applebot'],
        allow: ['/', '/books', '/exams', '/thumbs/'],
        disallow: ['/api/', '/purchased', '/read/', '/attempt/'],
      },
      // AI Citation & User-Triggered Fetchers
      {
        userAgent: ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot'],
        allow: ['/', '/books', '/exams', '/thumbs/'],
        disallow: ['/api/', '/purchased', '/read/', '/attempt/'],
      },
      // AI Bulk Training Crawlers Governed Independently
      {
        userAgent: ['CCBot'],
        disallow: ['/'],
      },
      // Default Rule
      {
        userAgent: '*',
        allow: ['/', '/thumbs/'],
        disallow: ['/api/', '/purchased', '/read/', '/attempt/'],
      },
    ],
    sitemap: [`${origin}/sitemap-index.xml`, `${origin}/sitemap.xml`],
  };
}
