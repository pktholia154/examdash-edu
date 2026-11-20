import type { MetadataRoute } from 'next';
import {
  getLiveBooks,
  getLiveExams,
} from '../server/repositories/catalog-repository';
import { getCanonicalOrigin } from '../lib/seo/schema';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = getCanonicalOrigin();
  const [books, exams] = await Promise.all([
    getLiveBooks().catch(() => []),
    getLiveExams().catch(() => []),
  ]);

  const latestCatalogMutation =
    [...books, ...exams]
      .map((i) => new Date(i.updatedAtIso).getTime())
      .sort((a, b) => b - a)[0] || Date.now();

  const entries: MetadataRoute.Sitemap = [
    {
      url: origin,
      lastModified: new Date(latestCatalogMutation),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${origin}/books`,
      lastModified: new Date(latestCatalogMutation),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${origin}/exams`,
      lastModified: new Date(latestCatalogMutation),
      changeFrequency: 'daily',
      priority: 0.9,
    },
  ];

  for (const book of books.slice(0, 2400)) {
    entries.push({
      url: `${origin}/books/${book.urlSlug}`,
      lastModified: new Date(book.updatedAtIso),
      changeFrequency: 'weekly',
      priority: 0.8,
    });
  }

  for (const exam of exams.slice(0, 2400)) {
    entries.push({
      url: `${origin}/exams/${exam.urlSlug}`,
      lastModified: new Date(exam.updatedAtIso),
      changeFrequency: 'weekly',
      priority: 0.8,
    });
  }

  return entries;
}
