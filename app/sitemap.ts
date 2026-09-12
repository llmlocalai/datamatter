import type { MetadataRoute } from 'next';
const ROUTES = ['', '/execution', '/program', '/traceability', '/linkage', '/jbook', '/reconciliation', '/funds-control', '/contracting',
  '/assistance', '/budget', '/audit', '/nfr', '/sbr', '/ppbe', '/congressional', '/sources', '/raw-data', '/definitions',
  '/controls', '/regulation'];
export default function sitemap(): MetadataRoute.Sitemap {
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://datamatter.vercel.app';
  const now = new Date();
  return ROUTES.map((r) => ({ url: `${site}${r}`, lastModified: now,
    changeFrequency: 'daily' as const, priority: r === '' ? 1 : 0.7 }));
}
