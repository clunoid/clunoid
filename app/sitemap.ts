import type { MetadataRoute } from "next";

/**
 * Sitemap for search engines. Today it lists the home page; once public
 * articles exist (see plan), this will also enumerate every /article/<slug>
 * from the articles store so they're all indexed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://clunoid.com",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
