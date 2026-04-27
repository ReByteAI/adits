/**
 * Per-host link preview resolver. Pure function, no network I/O.
 *
 * This is the ONE place in the codebase that knows about individual hosts.
 * Adding Vimeo/Loom/Twitter/etc. = one more case here. Everything else
 * (the chip, the editor, the storage, the prompt format) is generic.
 */

export interface LinkPreview {
  /** Display name for the chip and card title. */
  name: string
  /** Optional preview image URL (e.g. YouTube's public thumbnail CDN). */
  thumb?: string
  /** Optional embed URL for an iframe editor. If absent, the editor falls
   *  back to an "Open in new tab" card. */
  embedUrl?: string
}

/** YouTube video ID format: exactly 11 chars from [A-Za-z0-9_-]. */
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/

/** Extract a YouTube video ID from a URL, anchored by hostname — not substring
 *  matching, so `https://evil.example/img/youtu.be/XXXX` does NOT pass. */
export function parseYouTubeId(url: string): string | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.replace(/^www\./, '')
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') {
      const v = u.searchParams.get('v') ?? ''
      return YT_ID_RE.test(v) ? v : null
    }
    const m = u.pathname.match(/^\/(?:shorts|embed|v)\/([A-Za-z0-9_-]{11})(?:\/|$)/)
    return m ? m[1] : null
  }
  if (host === 'youtu.be') {
    const m = u.pathname.match(/^\/([A-Za-z0-9_-]{11})(?:\/|$)/)
    return m ? m[1] : null
  }
  return null
}

/** True if the text is a plausibly-well-formed http(s) URL. */
export function isHttpUrl(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  try {
    const u = new URL(trimmed)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Return a preview for a URL. Always returns a name; thumb/embed are optional. */
export function previewUrl(url: string): LinkPreview {
  const ytId = parseYouTubeId(url)
  if (ytId) {
    return {
      name: 'YouTube video',
      thumb: `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`,
      embedUrl: `https://www.youtube.com/embed/${ytId}`,
    }
  }

  // Generic fallback: use the hostname (plus first bit of path for flavor)
  try {
    const u = new URL(url)
    const pathBit = u.pathname.length > 1 ? u.pathname.slice(0, 40) : ''
    return { name: u.hostname + pathBit }
  } catch {
    return { name: url }
  }
}
