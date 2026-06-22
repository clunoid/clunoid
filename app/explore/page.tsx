import type { Metadata } from "next";
import Link from "next/link";
import { listArticles } from "@/lib/articles";
import { AskBar } from "@/components/AskBar";

// Always reflect the latest articles (no stale cache).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore",
  description: "Reliable, AI-researched answers to anything people are curious about — cross-checked and kept current.",
  alternates: { canonical: "https://clunoid.com/explore" },
};

const KIND: Record<string, string> = { calculation: "Calculation", explainer: "Explainer", rich_card: "Answer" };

export default async function ExplorePage() {
  const articles = await listArticles(500);
  return (
    <main className="stage-bg min-h-[100dvh] pb-32">
      <header className="flex w-full items-center justify-between px-5 py-4 sm:px-8">
        <Link href="/" className="font-serif text-lg text-ink/80">
          clunoid
        </Link>
      </header>

      <div className="w-full px-5 sm:px-8">
        <p className="max-w-3xl text-base leading-relaxed text-ink-muted sm:text-lg">
          <span className="font-semibold text-ink">Explore:</span> Reliable, AI-researched answers to anything people
          are curious about — cross-checked and kept current.
        </p>

        {articles.length === 0 ? (
          <p className="mt-16 text-ink-muted">No articles yet — be the first to ask Isaac something.</p>
        ) : (
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {articles.map((a) => (
              <Link
                key={a.slug}
                href={`/article/${a.slug}`}
                className="group rounded-2xl border border-border bg-surface/70 p-5 transition hover:border-clay/50 hover:bg-surface-2"
              >
                <div className="font-medium text-ink group-hover:text-clay">{a.title}</div>
                {a.summary && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{a.summary}</p>}
                {KIND[a.kind ?? ""] && (
                  <span className="mt-3 inline-block rounded-full bg-clay/15 px-2 py-0.5 text-xs font-medium text-clay">
                    {KIND[a.kind ?? ""]}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      <AskBar />
    </main>
  );
}
