import { createServerClient } from "@supabase/ssr";
import type { Experience } from "@/lib/brain/scene";
import { articleFields, slugify, summarize } from "./article-utils";

export { slugify, summarize };

export type Article = {
  slug: string;
  title: string;
  summary: string | null;
  kind: string | null;
  experience: Experience;
  views: number;
  created_at: string;
  updated_at: string;
};
export type ArticleMeta = Omit<Article, "experience">;

export const SITE = "https://clunoid.com";

/** A cookie-less anon client for PUBLIC reads/writes (articles are world-readable;
 *  writes go only through the validated SECURITY DEFINER RPC). */
function publicClient() {
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}

export async function getArticle(slug: string): Promise<Article | null> {
  try {
    const { data } = await publicClient().from("articles").select("*").eq("slug", slug).maybeSingle();
    return (data as Article) ?? null;
  } catch {
    return null;
  }
}

export async function listArticles(limit = 200): Promise<ArticleMeta[]> {
  try {
    const { data } = await publicClient()
      .from("articles")
      .select("slug,title,summary,kind,views,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit);
    return (data as ArticleMeta[]) ?? [];
  } catch {
    return [];
  }
}

/**
 * Publish/update a public article from a researched result. Only topic-based
 * experiences (no personal data) are ever published; same topic → same slug, so
 * popular topics keep refreshing with Isaac's latest, most accurate research.
 */
export async function publishArticle(exp: Experience, fallbackTitle: string): Promise<void> {
  const f = articleFields(exp, fallbackTitle);
  if (!f) return;
  try {
    await publicClient().rpc("upsert_article", {
      p_slug: f.slug,
      p_title: f.title,
      p_summary: f.summary,
      p_kind: f.kind,
      p_experience: exp,
    });
  } catch {
    /* never block or fail the request because of article publishing */
  }
}

/** Best-effort view counter. */
export async function bumpViews(slug: string): Promise<void> {
  try {
    await publicClient().rpc("bump_article_views", { p_slug: slug });
  } catch {
    /* ignore */
  }
}
