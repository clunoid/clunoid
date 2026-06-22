import type { Experience } from "@/lib/brain/scene";

// Reject anything that looks like personal data — articles are public knowledge only.
const PII = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b|\b\+?\d[\d ()-]{7,}\d\b/;

/** Turn a title into a clean, stable URL slug. Same topic → same slug → the
 *  article is UPDATED rather than duplicated (Wikipedia-style). */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** A short, plain-text summary of an experience for SEO meta + listings. */
export function summarize(exp: Experience): string {
  if (exp.type === "explainer") return exp.beats.map((b) => b.say).join(" ").slice(0, 320).trim();
  if (exp.type === "calculation") return (exp.intro || exp.context?.summary || exp.title || "").slice(0, 320).trim();
  if (exp.type === "rich_card") return (exp.body || exp.title || "").slice(0, 320).trim();
  return "";
}

export type ArticleFields = { slug: string; title: string; summary: string; kind: string };

/** Derive the publishable fields from a result, or null if it shouldn't be published
 *  (not topic-based, too short, or contains personal data). */
export function articleFields(exp: Experience, fallbackTitle = ""): ArticleFields | null {
  if (exp.type !== "explainer" && exp.type !== "calculation" && exp.type !== "rich_card") return null;
  const title = (("title" in exp && exp.title ? exp.title : fallbackTitle) || "").trim();
  if (title.length < 2 || title.length > 300 || PII.test(title)) return null;
  const summary = summarize(exp);
  if (PII.test(summary)) return null;
  const slug = slugify(title);
  if (!slug) return null;
  return { slug, title, summary, kind: exp.type };
}
