/**
 * Vimeo link handling for course lessons.
 *
 * Admins paste whatever URL Vimeo gave them. We pull the numeric video id
 * and, for unlisted videos, the privacy hash. An unlisted video won't play
 * in the embed without its hash, so it travels into every player URL.
 *
 * Shapes we accept:
 *   https://vimeo.com/123456789
 *   https://vimeo.com/123456789/abcdef1234            (unlisted share link)
 *   https://player.vimeo.com/video/123456789?h=abcdef1234
 *   https://vimeo.com/channels/staffpicks/123456789
 *   https://vimeo.com/showcase/111/video/123456789
 *   https://vimeo.com/manage/videos/123456789/abcdef1234
 *   https://vimeo.com/123456789?share=copy&h=abcdef1234
 */

export type ParsedVimeoUrl = { videoId: string; hash: string | null };

export function parseVimeoUrl(raw: string): ParsedVimeoUrl | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "vimeo.com" && !host.endsWith(".vimeo.com")) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  const isNumeric = (p: string | undefined) => p !== undefined && /^\d{3,}$/.test(p);
  // ".../video/123" and ".../videos/123" name the video outright. Otherwise
  // take the first number that isn't a showcase, album or group id.
  const marker = parts.findIndex((p, i) => (p === "video" || p === "videos") && isNumeric(parts[i + 1]));
  const idIndex =
    marker !== -1
      ? marker + 1
      : parts.findIndex((p, i) => isNumeric(p) && !["showcase", "album", "groups"].includes(parts[i - 1] ?? ""));
  if (idIndex === -1) return null;
  const videoId = parts[idIndex];

  const queryHash = url.searchParams.get("h");
  const next = parts[idIndex + 1];
  const pathHash = next && /^[a-f0-9]{6,}$/i.test(next) ? next : null;
  const hash = queryHash && /^[a-f0-9]{6,}$/i.test(queryHash) ? queryHash : pathHash;

  return { videoId, hash: hash ?? null };
}

/** Player URL for the lazy iframe. autoplay=1 because the man already
 *  clicked play on our thumbnail; dnt=1 keeps Vimeo from tracking him. */
export function vimeoEmbedUrl(videoId: string, hash: string | null): string {
  const params = new URLSearchParams();
  if (hash) params.set("h", hash);
  params.set("autoplay", "1");
  params.set("dnt", "1");
  return `https://player.vimeo.com/video/${encodeURIComponent(videoId)}?${params.toString()}`;
}

/** Canonical link we send to oEmbed. Unlisted videos need the hash in the
 *  path or Vimeo answers 404. */
export function canonicalVimeoUrl(videoId: string, hash: string | null): string {
  return hash ? `https://vimeo.com/${videoId}/${hash}` : `https://vimeo.com/${videoId}`;
}

export type VimeoMetadata = {
  videoId: string;
  hash: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  title: string | null;
};

export const VIMEO_READ_ERROR =
  "We couldn't read that Vimeo link. Check that the video exists and that embedding is allowed.";

/**
 * Validate a pasted link against Vimeo's public oEmbed endpoint and return
 * what we store on the lesson. Returns null when the link doesn't parse or
 * Vimeo won't describe it; callers show VIMEO_READ_ERROR.
 *
 * The Referer header matters for domain-restricted videos: Vimeo only
 * answers oEmbed for those when the request names an allowed domain.
 */
export async function fetchVimeoMetadata(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VimeoMetadata | null> {
  const parsed = parseVimeoUrl(raw);
  if (!parsed) return null;
  const target = canonicalVimeoUrl(parsed.videoId, parsed.hash);
  const endpoint = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(target)}&width=960`;
  const referer = process.env.NEXT_PUBLIC_APP_URL;
  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      headers: referer ? { Referer: referer } : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
  const returnedId = body.video_id != null ? String(body.video_id) : parsed.videoId;
  const thumb = typeof body.thumbnail_url === "string" ? body.thumbnail_url : null;
  const duration = typeof body.duration === "number" ? Math.round(body.duration) : null;
  const title = typeof body.title === "string" ? body.title : null;
  return {
    videoId: returnedId,
    hash: parsed.hash,
    thumbnailUrl: thumb && thumb.startsWith("https://") ? thumb : null,
    durationSeconds: duration,
    title,
  };
}

/** "9:57" or "1:02:05". */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
