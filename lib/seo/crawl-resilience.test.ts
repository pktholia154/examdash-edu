import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSwrState,
  extractPreloadNextImageUrls,
} from './crawl-resilience';

test('evaluateSwrState distinguishes fresh, stale, and expired windows', () => {
  assert.equal(evaluateSwrState(null, 1000), 'expired');

  const window = { freshUntilMs: 61_000, staleUntilMs: 601_000 };
  assert.equal(evaluateSwrState(window, 10_000), 'fresh');
  assert.equal(evaluateSwrState(window, 60_999), 'fresh');
  assert.equal(evaluateSwrState(window, 61_000), 'stale');
  assert.equal(evaluateSwrState(window, 600_999), 'stale');
  assert.equal(evaluateSwrState(window, 601_000), 'expired');
});

test('extractPreloadNextImageUrls parses HTML entities and prioritizes 2x DPR preload variants', () => {
  const html = `
    <html>
      <head>
        <link rel="preload" as="image" imageSrcSet="/_next/image?url=https%3A%2F%2Ffirebasestorage.googleapis.com%2Fv0%2Fb%2Fcover.png&amp;w=128&amp;q=75 1x, /_next/image?url=https%3A%2F%2Ffirebasestorage.googleapis.com%2Fv0%2Fb%2Fcover.png&amp;w=256&amp;q=75 2x" fetchPriority="high" />
        <link rel="preload" as="image" href="https://evil.example.com/_next/image?url=x&amp;w=128&amp;q=75" />
      </head>
      <body>
        <img src="/_next/image?url=%2F_next%2Fstatic%2Fmedia%2Flogo.abc.png&amp;w=96&amp;q=75" loading="eager" />
      </body>
    </html>
  `;

  const urls = extractPreloadNextImageUrls(html, 'https://exam-dash.com', 3);
  assert.equal(urls.length, 3);
  assert.equal(
    urls[0],
    'https://exam-dash.com/_next/image?url=https%3A%2F%2Ffirebasestorage.googleapis.com%2Fv0%2Fb%2Fcover.png&w=256&q=75'
  );
  assert.equal(
    urls[1],
    'https://exam-dash.com/_next/image?url=https%3A%2F%2Ffirebasestorage.googleapis.com%2Fv0%2Fb%2Fcover.png&w=128&q=75'
  );
  assert.equal(
    urls[2],
    'https://exam-dash.com/_next/image?url=%2F_next%2Fstatic%2Fmedia%2Flogo.abc.png&w=96&q=75'
  );
});

test('extractPreloadNextImageUrls rejects non-Next-Image paths and external origins', () => {
  const html = `
    <link rel="preload" as="image" href="https://attacker.com/secret.png" />
    <link rel="preload" as="image" href="/api/v1/private" />
    <img src="/_next/image?url=%2Flogo.png&amp;w=96&amp;q=75" loading="lazy" />
  `;

  const urls = extractPreloadNextImageUrls(html, 'https://exam-dash.com', 3);
  assert.deepEqual(urls, []);
});
