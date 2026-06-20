/**
 * Pexels media — free, reliable, hotlink-safe stock PHOTOS and VIDEO clips.
 * This is the primary engine for scene/action visuals (and the only video
 * source). Gated on PEXELS_API_KEY; without it we fall back to other sources.
 */
const API = "https://api.pexels.com";
const hasKey = () => !!process.env.PEXELS_API_KEY;
export const hasPexels = hasKey;

type VideoFile = { link?: string; width?: number; file_type?: string };
type PexelsVideo = { image?: string; video_files?: VideoFile[] };
type PexelsPhoto = { src?: { large2x?: string; large?: string } };

/** Top photo URLs for a query (large size). */
export async function pexelsPhotos(query: string, n = 4): Promise<string[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key || !query.trim()) return [];
  try {
    const res = await fetch(
      `${API}/v1/search?query=${encodeURIComponent(query)}&per_page=${n}&orientation=landscape`,
      { headers: { Authorization: key } }
    );
    if (!res.ok) return [];
    const d = (await res.json()) as { photos?: PexelsPhoto[] };
    return (d.photos ?? []).map((p) => p.src?.large2x || p.src?.large).filter((u): u is string => !!u);
  } catch {
    return [];
  }
}

/** Top video clips for a query — an MP4 around HD width, plus a poster image. */
export async function pexelsVideos(query: string, n = 4): Promise<{ url: string; poster?: string }[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key || !query.trim()) return [];
  try {
    const res = await fetch(
      `${API}/videos/search?query=${encodeURIComponent(query)}&per_page=${n}&orientation=landscape`,
      { headers: { Authorization: key } }
    );
    if (!res.ok) return [];
    const d = (await res.json()) as { videos?: PexelsVideo[] };
    const out: { url: string; poster?: string }[] = [];
    for (const v of d.videos ?? []) {
      const mp4s = (v.video_files ?? [])
        .filter((f) => f.file_type === "video/mp4" && f.link)
        .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
      // Prefer ~720p–1080p for quality without huge files.
      const pick = mp4s.find((f) => (f.width ?? 0) >= 900 && (f.width ?? 0) <= 1400) ?? mp4s[mp4s.length - 1];
      if (pick?.link) out.push({ url: pick.link, poster: v.image });
    }
    return out;
  } catch {
    return [];
  }
}
