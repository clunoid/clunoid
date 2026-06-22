/**
 * Free, current factual lookups + images from Wikipedia. Used to keep Isaac
 * accurate and up to date (his training data goes stale), and to show a related
 * picture alongside what he's talking about.
 */
export type WikiResult = {
  title: string;
  extract: string;
  imageUrl?: string;
  url?: string;
};

const UA = "Clunoid/1.0 (https://github.com/clunoid/clunoid)";

/**
 * Cap a Wikimedia image to a sensible display width (default 1280px) so we never
 * download multi-MB originals (3840px+) — much faster to load, no visible quality
 * loss at our display sizes. Handles both existing thumbnails and raw originals;
 * leaves non-Wikimedia and SVG URLs untouched.
 */
export function shrinkWikimedia(url: string | undefined, width = 1280): string | undefined {
  if (!url || !url.includes("upload.wikimedia.org") || /\.svg$/i.test(url)) return url;
  const thumb = url.match(/\/(\d+)px-([^/]+)$/);
  if (thumb) {
    return Number(thumb[1]) > width ? url.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`) : url;
  }
  // A full original (…/wikipedia/<proj>/a/ab/Name.jpg) → width-capped thumbnail.
  const parts = url.split("/");
  const file = parts[parts.length - 1];
  const proj = parts.findIndex((p) => p === "commons" || p === "en");
  if (proj === -1 || !file) return url;
  parts.splice(proj + 1, 0, "thumb");
  return `${parts.join("/")}/${width}px-${file}`;
}

async function summary(title: string): Promise<WikiResult | null> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: { accept: "application/json", "user-agent": UA } }
    );
    if (!res.ok) return null;
    const d = (await res.json()) as {
      type?: string;
      title?: string;
      extract?: string;
      thumbnail?: { source?: string };
      originalimage?: { source?: string };
      content_urls?: { desktop?: { page?: string } };
    };
    if (!d.extract || d.type === "disambiguation") return null;
    return {
      title: d.title ?? title,
      extract: d.extract,
      imageUrl: shrinkWikimedia(d.originalimage?.source ?? d.thumbnail?.source),
      url: d.content_urls?.desktop?.page,
    };
  } catch {
    return null;
  }
}

/** Search Wikipedia for the best-matching page, then return its summary. */
export async function fetchWiki(query: string): Promise<WikiResult | null> {
  const q = query.trim();
  if (!q) return null;

  // Try a direct summary first (fast path for clean entity names).
  const direct = await summary(q);
  if (direct) return direct;

  // Otherwise search for the best page title, then summarise it.
  try {
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        q
      )}&srlimit=1&format=json`,
      { headers: { accept: "application/json", "user-agent": UA } }
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { query?: { search?: { title?: string }[] } };
    const top = d.query?.search?.[0]?.title;
    return top ? summary(top) : null;
  } catch {
    return null;
  }
}
