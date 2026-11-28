import type { MetadataRoute } from 'next';
import { getCanonicalOrigin } from '../lib/seo/schema';

const PUBLIC_ALLOW_PATHS = [
  '/',
  '/_next/static/',
  '/_next/image',
  '/books',
  '/exams',
  '/sitemaps/',
  '/app-icons/',
  '/feed.xml',
];

const PRIVATE_AND_TRAP_DISALLOW_PATHS = [
  '/api/',
  '/purchased',
  '/profile',
  '/read/',
  '/attempt/',
  '/search',
  '/admin/',
  '/account/',
  '/checkout/',
  '/*?q=',
];

export default function robots(): MetadataRoute.Robots {
  const origin = getCanonicalOrigin();

  return {
    rules: [
      // Core Search Engine Indexers
      {
        userAgent: [
          'Googlebot',
          'Googlebot-Image',
          'Bingbot',
          'Applebot',
          'DuckDuckBot',
          'Slurp',
          'Yandex',
        ],
        allow: PUBLIC_ALLOW_PATHS,
        disallow: PRIVATE_AND_TRAP_DISALLOW_PATHS,
      },
      // AI Search Citation, Grounding & User-Triggered Retrieval Agents
      {
        userAgent: [
          'OAI-SearchBot',
          'ChatGPT-User',
          'Claude-SearchBot',
          'Claude-User',
          'PerplexityBot',
          'Perplexity-User',
          'Google-Extended',
          'DuckAssistBot',
          'Applebot-Extended',
        ],
        allow: PUBLIC_ALLOW_PATHS,
        disallow: PRIVATE_AND_TRAP_DISALLOW_PATHS,
      },
      // Bulk Foundation-Model Training Scrapers Governed Independently
      {
        userAgent: [
          'GPTBot',
          'ClaudeBot',
          'CCBot',
          'Bytespider',
          'Google-CloudVertexBot',
          'Meta-ExternalAgent',
          'Amazonbot',
        ],
        disallow: ['/'],
      },
      // Default Policy for Standard Web Crawlers
      {
        userAgent: '*',
        allow: PUBLIC_ALLOW_PATHS,
        disallow: PRIVATE_AND_TRAP_DISALLOW_PATHS,
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
