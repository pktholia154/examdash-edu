/**
 * Pure crawl-resilience helpers shared across edge middleware and publish pre-warming:
 * 1. Stale-while-revalidate (SWR) freshness evaluator for edge tombstone snapshots so
 *    first-crawl HTML TTFB never blocks periodically on Firestore queries.
 * 2. SSRF-safe extractor for same-origin `/_next/image` preload URLs embedded in
 *    rendered HTML so CMS publish webhooks pre-warm optimized hero covers before Googlebot arrives.
 */

export type SwrCacheState = 'fresh' | 'stale' | 'expired';

export interface SwrWindow {
  freshUntilMs: number;
  staleUntilMs: number;
}

export function evaluateSwrState(
  snapshot: SwrWindow | null,
  nowMs: number
): SwrCacheState {
  if (!snapshot) return 'expired';
  if (nowMs < snapshot.freshUntilMs) return 'fresh';
  if (nowMs < snapshot.staleUntilMs) return 'stale';
  return 'expired';
}

function decodeBasicHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/gi, '&')
    .replace(/&#x26;/gi, '&')
    .replace(/&#38;/g, '&')
    .trim();
}

function parseSrcsetUrls(srcset: string): string[] {
  const candidates: Array<{ url: string; descriptorWeight: number }> = [];
  for (const part of srcset.split(',')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const rawUrl = decodeBasicHtmlEntities(tokens[0]);
    if (!rawUrl) continue;
    const descriptor = tokens[1] || '1x';
    let weight = 1;
    if (descriptor.endsWith('x')) {
      const parsed = Number.parseFloat(descriptor.slice(0, -1));
      if (Number.isFinite(parsed)) weight = parsed * 1000;
    } else if (descriptor.endsWith('w')) {
      const parsed = Number.parseFloat(descriptor.slice(0, -1));
      if (Number.isFinite(parsed)) weight = parsed;
    }
    candidates.push({ url: rawUrl, descriptorWeight: weight });
  }
  // Prefer 2x / crisp smartphone DPR variant first (e.g. w=256), then 1x fallback
  candidates.sort((a, b) => b.descriptorWeight - a.descriptorWeight);
  return candidates.map((c) => c.url);
}

/**
 * Extracts up to `maxUrls` same-origin `/_next/image` URLs from `<link rel="preload" as="image">`
 * tags (and high-priority hero `<img>` tags if needed) in rendered HTML.
 * Strictly confines output to `https://<origin.host>/_next/image?...` (SSRF-safe).
 */
export function extractPreloadNextImageUrls(
  html: string,
  origin: string,
  maxUrls = 3
): string[] {
  if (!html || !origin || maxUrls <= 0) return [];

  let canonicalOriginUrl: URL;
  try {
    canonicalOriginUrl = new URL(origin);
  } catch {
    return [];
  }

  const results: string[] = [];
  const seen = new Set<string>();

  const pushCandidate = (rawHref: string) => {
    if (results.length >= maxUrls) return;
    const decoded = decodeBasicHtmlEntities(rawHref);
    if (!decoded) return;
    try {
      const resolved = new URL(decoded, canonicalOriginUrl);
      if (
        resolved.protocol !== 'https:' ||
        resolved.host !== canonicalOriginUrl.host ||
        resolved.pathname !== '/_next/image'
      ) {
        return;
      }
      const normalized = resolved.toString();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        results.push(normalized);
      }
    } catch {
      // Ignore malformed candidate URLs
    }
  };

  // 1. Inspect <link ... rel="preload" ... as="image" ...> tags emitted by Next.js <Image priority>
  const linkTagRegex = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkTagRegex.exec(html)) !== null && results.length < maxUrls) {
    const tag = match[0];
    if (!/\brel=["']preload["']/i.test(tag)) continue;
    if (!/\bas=["']image["']/i.test(tag)) continue;

    const imageSrcSetMatch = tag.match(/\bimageSrcSet=["']([^"']+)["']/i);
    if (imageSrcSetMatch?.[1]) {
      for (const u of parseSrcsetUrls(imageSrcSetMatch[1])) {
        pushCandidate(u);
      }
    }

    const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
    if (hrefMatch?.[1]) {
      pushCandidate(hrefMatch[1]);
    }
  }

  // 2. Fallback: inspect high-priority or eager hero <img ... src="/_next/image?..."> tags
  if (results.length < maxUrls) {
    const imgTagRegex = /<img\b[^>]*>/gi;
    while ((match = imgTagRegex.exec(html)) !== null && results.length < maxUrls) {
      const tag = match[0];
      const isPriorityHero =
        /\bfetchpriority=["']high["']/i.test(tag) ||
        /\bloading=["']eager["']/i.test(tag);
      if (!isPriorityHero) continue;

      const srcSetMatch = tag.match(/\bsrcSet=["']([^"']+)["']/i);
      if (srcSetMatch?.[1]) {
        for (const u of parseSrcsetUrls(srcSetMatch[1])) {
          pushCandidate(u);
        }
      }
      const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
      if (srcMatch?.[1]) {
        pushCandidate(srcMatch[1]);
      }
    }
  }

  return results;
}
