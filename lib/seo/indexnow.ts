import crypto from 'node:crypto';
import https from 'node:https';
import { getCanonicalOrigin } from './schema';

const INDEXNOW_KEY_REGEX = /^[a-zA-Z0-9-]{8,128}$/;

export function getConfiguredIndexNowKey(): string | null {
  const raw = (process.env.INDEXNOW_KEY || '').trim();
  if (!raw || !INDEXNOW_KEY_REGEX.test(raw)) {
    return null;
  }
  return raw;
}

export function verifySeoWebhookSecret(providedSecret: string | null): boolean {
  const configured = (process.env.SEO_WEBHOOK_SECRET || '').trim();
  const candidate = (providedSecret || '').trim();
  if (!configured || !candidate) {
    return false;
  }
  const expectedHash = crypto.createHash('sha256').update(configured, 'utf8').digest();
  const candidateHash = crypto.createHash('sha256').update(candidate, 'utf8').digest();
  return crypto.timingSafeEqual(expectedHash, candidateHash);
}

/**
 * Sanitizes and filters candidate URLs or relative paths so ONLY canonical URLs
 * belonging to `getCanonicalOrigin()` are ever dispatched to IndexNow.
 */
export function sanitizeCanonicalUrlBatch(
  rawInputs: readonly unknown[],
  origin: string = getCanonicalOrigin()
): string[] {
  const canonicalHost = new URL(origin).host;
  const deduped = new Set<string>();

  for (const raw of rawInputs) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    try {
      const resolved = trimmed.startsWith('/')
        ? new URL(trimmed, origin)
        : new URL(trimmed);

      if (resolved.protocol !== 'https:' || resolved.host !== canonicalHost) {
        continue;
      }

      // Strip fragments and disallowed private paths
      resolved.hash = '';
      if (
        resolved.pathname.startsWith('/api/') ||
        resolved.pathname.startsWith('/purchased') ||
        resolved.pathname.startsWith('/profile') ||
        resolved.pathname.startsWith('/read/') ||
        resolved.pathname.startsWith('/attempt/') ||
        resolved.pathname.startsWith('/search')
      ) {
        continue;
      }

      deduped.add(resolved.toString());
      if (deduped.size >= 10000) break;
    } catch {
      // Ignore malformed URLs
    }
  }

  return Array.from(deduped);
}

export interface IndexNowDispatchResult {
  dispatched: boolean;
  statusCode: number;
  submittedCount: number;
  message: string;
}

/**
 * Dispatches event-driven IndexNow batch notifications strictly to `https://api.indexnow.org/indexnow`
 * for instant crawl discovery across Bing, Yandex, Naver, Seznam, and AI search citation partners.
 */
export function submitIndexNowBatch(
  rawUrls: readonly unknown[]
): Promise<IndexNowDispatchResult> {
  const origin = getCanonicalOrigin();
  const key = getConfiguredIndexNowKey();
  const urlList = sanitizeCanonicalUrlBatch(rawUrls, origin);

  if (urlList.length === 0) {
    return Promise.resolve({
      dispatched: false,
      statusCode: 400,
      submittedCount: 0,
      message: 'No valid canonical URLs provided for IndexNow notification.',
    });
  }

  if (!key) {
    return Promise.resolve({
      dispatched: false,
      statusCode: 202,
      submittedCount: urlList.length,
      message:
        'Sitemap cache invalidated; set INDEXNOW_KEY in environment secrets to enable external IndexNow push.',
    });
  }

  const host = new URL(origin).hostname;
  const payload = JSON.stringify({
    host,
    key,
    keyLocation: `${origin}/${key}.txt`,
    urlList,
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.indexnow.org',
        port: 443,
        path: '/indexnow',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 6000,
      },
      (res) => {
        res.resume();
        const code = res.statusCode || 502;
        const ok = code === 200 || code === 202;
        resolve({
          dispatched: ok,
          statusCode: code,
          submittedCount: urlList.length,
          message: ok
            ? `Submitted ${urlList.length} canonical URL(s) to IndexNow.`
            : `IndexNow endpoint responded with HTTP ${code}.`,
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({
        dispatched: false,
        statusCode: 504,
        submittedCount: urlList.length,
        message: 'IndexNow upstream request timed out.',
      });
    });

    req.on('error', () => {
      resolve({
        dispatched: false,
        statusCode: 502,
        submittedCount: urlList.length,
        message: 'Unable to reach IndexNow endpoint.',
      });
    });

    req.write(payload);
    req.end();
  });
}
