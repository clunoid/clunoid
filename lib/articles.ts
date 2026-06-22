import { createServerClient } from "@supabase/ssr";
import type { Experience } from "@/lib/brain/scene";

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

/** Turn a title into a clean, stable URL slug. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Reject anything that looks like personal data — articles are public knowledge only.
const PII = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b|\b\+?\d[\d ()-]{7,}\d\b/;

/** A short, plain-text summary of an experience for SEO meta + listings. */
export function summarize(exp: Experience): string {
  if (exp.type === "explainer") return exp.beats.map((b) => b.say).join(" ").slice(0, 320).trim();
  if (exp.type === "calculation") return (exp.intro || exp.context?.summary || exp.title || "").slice(0, 320).trim();
  if (exp.type === "rich_card") return (exp.body || exp.title || "").slice(0, 320).trim();
  return "";
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
  if (exp.type !== "explainer" && exp.type !== "calculation" && exp.type !== "rich_card") return;
  const title = (("title" in exp && exp.title ? exp.title : fallbackTitle) || "").trim();
  if (title.length < 2 || PII.test(title)) return;
  const summary = summarize(exp);
  if (PII.test(summary)) return;
  const slug = slugify(title);
  if (!slug) return;
  try {
    await publicClient().rpc("upsert_article", {
      p_slug: slug,
      p_title: title,
      p_summary: summary,
      p_kind: exp.type,
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
