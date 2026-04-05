/**
 * Resolve link metadata for composer preview (Bluesky cardyb service).
 */
export interface LinkPreviewData {
  url: string;
  title: string;
  description: string;
  image: string;
}

export async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    const res = await fetch(
      `https://cardyb.bsky.app/v1/extract?url=${encodeURIComponent(u)}`,
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      error?: string;
      title?: string;
      description?: string;
      image?: string;
      url?: string;
    };
    if (j.error) return null;
    const title = (j.title || '').trim() || u;
    return {
      url: j.url || u,
      title,
      description: (j.description || '').trim(),
      image: (j.image || '').trim(),
    };
  } catch {
    return null;
  }
}
