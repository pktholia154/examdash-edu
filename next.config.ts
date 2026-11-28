import fs from 'node:fs';
import path from 'node:path';
import type {NextConfig} from 'next';

function computeDevDeploymentId(): string | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  let maxMtime = 1;
  const scanTarget = (targetPath: string) => {
    try {
      const stat = fs.statSync(targetPath);
      const mtime = Math.floor(stat.mtimeMs);
      if (mtime > maxMtime) maxMtime = mtime;
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(targetPath)) {
          if (entry.startsWith('.')) continue;
          scanTarget(path.join(targetPath, entry));
        }
      }
    } catch {
      // Ignore missing optional paths
    }
  };

  const root = process.cwd();
  for (const rel of ['app', 'features', 'components', 'lib', 'hooks', 'middleware.ts', 'next.config.ts']) {
    scanTarget(path.join(root, rel));
  }
  return `dev-${maxMtime}`;
}

const devDeploymentId = computeDevDeploymentId();

const nextConfig: NextConfig = {
  ...(devDeploymentId ? { deploymentId: devDeploymentId } : {}),
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Optimized image delivery for instant first-crawl Googlebot WRS rendering:
  // - Single WebP format (~10x faster encode than AVIF on Cloud Run with native sharp)
  // - 31-day minimumCacheTTL so optimized remote covers stay warm across crawl sessions
  // - Compact deviceSizes/imageSizes to eliminate 16-entry srcset bloat & w=3840 fallback URLs
  // - Inline Content-Disposition for clean browser & crawler handling
  images: {
    formats: ['image/webp'],
    qualities: [75],
    minimumCacheTTL: 2678400,
    contentDispositionType: 'inline',
    deviceSizes: [384, 640, 828, 1200],
    imageSizes: [48, 64, 96, 128, 192, 256],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '**.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  output: 'standalone',
  outputFileTracingIncludes: {
    '/app-icons/[file]': [
      './public/apple-touch-icon.png',
      './public/pwa-*.png',
      './public/favicon-32x32.png',
    ],
    '/manifest.webmanifest': ['./public/pwa-*.png'],
  },
  devIndicators: false,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  transpilePackages: ['motion'],
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';
    return [
      {
        source: '/.well-known/apple-app-site-association',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
      {
        source: '/.well-known/assetlinks.json',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'X-Robots-Tag', value: 'noindex' },
        ],
      },
      ...(isProd
        ? [
            {
              source: '/_next/static/:path*',
              headers: [
                {
                  key: 'Cache-Control',
                  value: 'public, max-age=31536000, s-maxage=31536000, immutable',
                },
                {
                  key: 'CDN-Cache-Control',
                  value: 'public, max-age=31536000, immutable',
                },
              ],
            },
            {
              source: '/_next/image',
              headers: [
                {
                  key: 'CDN-Cache-Control',
                  value:
                    'public, max-age=2678400, s-maxage=2678400, stale-while-revalidate=86400',
                },
              ],
            },
            {
              source: '/assets/:path*',
              headers: [
                {
                  key: 'Cache-Control',
                  value: 'public, max-age=31536000, s-maxage=31536000, immutable',
                },
              ],
            },
            {
              source: '/app-icons/:path*',
              headers: [
                {
                  key: 'Cache-Control',
                  value: 'public, max-age=31536000, s-maxage=31536000, immutable',
                },
              ],
            },
          ]
        : [
            {
              source: '/_next/static/:path*',
              headers: [
                {
                  key: 'Cache-Control',
                  value: 'no-store, must-revalidate',
                },
              ],
            },
          ]),
      {
        source: '/wasm/:path*',
        headers: [
          { key: 'Content-Type', value: 'application/wasm' },
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, s-maxage=31536000, immutable',
          },
        ],
      },
    ];
  },
  webpack: (config, { dev, isServer, webpack }) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }

    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
          resource.request = resource.request.replace(/^node:/, '');
        })
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        'fs/promises': false,
        path: false,
        url: false,
        module: false,
        crypto: false,
      };

      // Consolidate tiny shared client chunks in production so Googlebot WRS fetches
      // <= 6 JS bundles per route (eliminating same-host request storms on first crawl)
      // while keeping every single uncompressed JS asset < 450 KB (Pillar 1).
      if (
        !dev &&
        config.optimization?.splitChunks &&
        typeof config.optimization.splitChunks === 'object'
      ) {
        const existingCacheGroups =
          typeof config.optimization.splitChunks.cacheGroups === 'object' &&
          config.optimization.splitChunks.cacheGroups !== null
            ? (config.optimization.splitChunks.cacheGroups as Record<
                string,
                unknown
              >)
            : {};

        config.optimization.splitChunks = {
          ...config.optimization.splitChunks,
          minSize: 65000,
          maxInitialRequests: 6,
          maxAsyncRequests: 10,
          cacheGroups: {
            ...existingCacheGroups,
            shared: false,
            commons: false,
            appShared: {
              name: 'app-shared',
              chunks: 'initial',
              minChunks: 10,
              minSize: 0,
              priority: 25,
              reuseExistingChunk: true,
              test: (module: { type?: string; resource?: string }) =>
                !module?.type?.startsWith('css/') &&
                !(module?.resource || '').includes('firebase'),
            },
          },
        };
      }
    }

    return config;
  },
};

export default nextConfig;
