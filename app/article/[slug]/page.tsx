import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getArticle, summarize, SITE } from "@/lib/articles";
import { AskBar } from "@/components/AskBar";
import type { Experience } from "@/lib/brain/scene";

// Re-fetched at most every few minutes so updates show without re-deploying.
export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

// Dedupe the DB read between generateMetadata and the page (one read per request).
const loadArticle = cache((slug: string) => getArticle(slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = await loadArticle(slug);
  if (!a) return { title: "Article not found" };
  const description = (a.summary || summarize(a.experience) || a.title).slice(0, 200);
  const url = `${SITE}/article/${slug}`;
  return {
    title: a.title,
    description,
    alternates: { canonical: url },
    openGraph: { title: a.title, description, url, type: "article", siteName: "Clunoid" },
    twitter: { card: "summary_large_image", title: a.title, description },
  };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const a = await loadArticle(slug);
  if (!a) notFound();

  const updated = new Date(a.updated_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const description = a.summary || summarize(a.experience);
  const askUrl = `/?q=${encodeURIComponent(a.title)}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description,
    datePublished: a.created_at,
    dateModified: a.updated_at,
    author: { "@type": "Organization", name: "Clunoid" },
    publisher: { "@type": "Organization", name: "Clunoid", url: SITE },
    mainEntityOfPage: `${SITE}/article/${slug}`,
  };

  return (
    <main className="stage-bg min-h-[100dvh] pb-32">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
        <header className="mb-8 flex items-center justify-between">
          <Link href="/" className="font-serif text-lg text-ink/80">
            clunoid
          </Link>
          <Link href="/explore" className="text-sm text-ink-muted transition hover:text-ink">
            Explore
          </Link>
        </header>

        <article>
          <h1 className="font-serif text-3xl leading-tight text-ink sm:text-4xl">{a.title}</h1>
          <p className="mt-3 text-xs text-ink-faint">Researched &amp; verified by Isaac · Updated {updated}</p>
          {description && <p className="mt-6 text-lg leading-relaxed text-ink-muted">{description}</p>}
          <div className="mt-8">
            <Body experience={a.experience} />
          </div>
        </article>

        <div className="mt-14 rounded-2xl border border-clay/40 bg-surface/70 p-6 text-center backdrop-blur">
          <p className="text-ink">Curious about something else, or want to go deeper?</p>
          <Link
            href={askUrl}
            className="mt-4 inline-block rounded-full bg-clay px-6 py-3 font-medium text-[#1F1E1C] shadow-glow transition hover:bg-clay-soft"
          >
            Ask Isaac on Clunoid →
          </Link>
        </div>

        <footer className="mt-10 text-center text-xs leading-relaxed text-ink-faint">
          Clunoid articles are researched, cross-checked, and kept current by AI — built from people&apos;s curiosity.{" "}
          <Link href="/" className="underline">
            clunoid.com
          </Link>
        </footer>
      </div>
      <AskBar />
    </main>
  );
}

/* eslint-disable @next/next/no-img-element */
function Img({ src, alt }: { src?: string; alt: string }) {
  if (!src) return null;
  return <img src={src} alt={alt} className="w-full rounded-2xl border border-border bg-surface/40 object-contain" />;
}

function Body({ experience }: { experience: Experience }) {
  const exp = experience;

  if (exp.type === "explainer") {
    return (
      <div className="flex flex-col gap-10">
        {exp.beats.map((b, i) => (
          <section key={i}>
            <Img src={b.entity?.imageUrl || b.entity?.poster} alt={b.entity?.caption || exp.title || a_title(exp)} />
            <p className="mt-3 text-[17px] leading-relaxed text-ink">{b.say}</p>
          </section>
        ))}
      </div>
    );
  }

  if (exp.type === "calculation") {
    const answers = exp.answers ?? [];
    return (
      <div className="flex flex-col gap-6">
        {exp.context?.summary && <p className="leading-relaxed text-ink-muted">{exp.context.summary}</p>}
        <ol className="flex flex-col gap-4">
          {exp.steps.map((s, i) => (
            <li key={i} className="rounded-xl border border-border bg-surface/60 p-4">
              <div className="text-sm font-semibold text-clay">
                {i + 1}. {s.title || `Step ${i + 1}`}
              </div>
              <p className="mt-1 leading-relaxed text-ink-muted">{s.text}</p>
              {s.latex && (
                <pre className="mt-2 overflow-x-auto rounded-lg bg-base/60 p-3 text-sm text-clay-soft">{s.latex}</pre>
              )}
            </li>
          ))}
        </ol>
        {(exp.finalAnswer || answers.length > 0) && (
          <div className="rounded-xl border border-spark/50 bg-spark/10 p-4">
            <div className="text-[11px] uppercase tracking-wide text-ink-muted">{answers.length > 1 ? "Answers" : "Answer"}</div>
            {answers.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-1">
                {answers.map((x, i) => (
                  <li key={i} className="text-ink">
                    <span className="text-ink-muted">{x.label}:</span> {x.value}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-1 font-serif text-lg text-ink">{exp.finalAnswer}</div>
            )}
          </div>
        )}
        {exp.context?.facts && exp.context.facts.length > 0 && (
          <div>
            <h2 className="font-serif text-xl text-ink">Facts &amp; context</h2>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-ink-muted">
              {exp.context.facts.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (exp.type === "rich_card") {
    return (
      <div>
        <Img src={exp.imageUrl} alt={exp.title || ""} />
        {exp.body && <p className="mt-3 text-[17px] leading-relaxed text-ink">{exp.body}</p>}
      </div>
    );
  }

  return null;
}

function a_title(exp: Experience): string {
  return "title" in exp && exp.title ? exp.title : "";
}
