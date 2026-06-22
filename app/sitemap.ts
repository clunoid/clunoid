import type { MetadataRoute } from "next";
import { listArticles, SITE } from "@/lib/articles";

export const revalidate = 600;

// Lists the home page, the explore index, and every public article so search
// engines can discover and index them all.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const articles = await listArticles(5000);
  return [
    { url: SITE, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${SITE}/explore`, lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
    ...articles.map((a) => ({
      url: `${SITE}/article/${a.slug}`,
      lastModified: new Date(a.updated_at),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
