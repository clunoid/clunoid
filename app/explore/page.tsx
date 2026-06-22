import type { Metadata } from "next";
import Link from "next/link";
import { listArticles } from "@/lib/articles";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Explore",
  description: "Browse Clunoid — reliable, AI-researched answers to anything people are curious about.",
  alternates: { canonical: "https://clunoid.com/explore" },
};

const KIND: Record<string, string> = { calculation: "Calculation", explainer: "Explainer", rich_card: "Answer" };

export default async function ExplorePage() {
  const articles = await listArticles(200);
  return (
    <main className="stage-bg min-h-[100dvh]">
      <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8">
        <header className="mb-8 flex items-center justify-between">
          <Link href="/" className="font-serif text-lg text-ink/80">
            clunoid
          </Link>
          <Link
            href="/"
            className="rounded-full bg-clay px-4 py-1.5 text-sm font-medium text-[#1F1E1C] transition hover:bg-clay-soft"
          >
            Ask Isaac
          </Link>
        </header>

        <h1 className="font-serif text-3xl text-ink sm:text-4xl">Explore Clunoid</h1>
        <p className="mt-3 max-w-2xl text-ink-muted">
          Reliable, AI-researched answers to anything people are curious about — cross-checked and kept current.
        </p>

        {articles.length === 0 ? (
          <p className="mt-16 text-center text-ink-muted">No articles yet — be the first to ask Isaac something.</p>
        ) : (
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
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
    </main>
  );
}
