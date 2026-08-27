import type { MetadataRoute } from 'next';
const ROUTES = ['', '/execution', '/reconciliation', '/funds-control', '/contracting',
  '/budget', '/audit', '/ppbe', '/congressional', '/sources', '/definitions',
  '/controls', '/regulation'];
export default function sitemap(): MetadataRoute.Sitemap {
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://datamatter.vercel.app';
  const now = new Date();
  return ROUTES.map((r) => ({ url: `${site}${r}`, lastModified: now,
    changeFrequency: 'daily' as const, priority: r === '' ? 1 : 0.7 }));
}
