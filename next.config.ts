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
  // Allow access to remote image placeholder.
  images: {
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
                  key: 'Cache-Control',
                  value:
                    'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
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

      // Consolidate tiny shared client chunks in production so Googlebot WRS never hits
      // 20+ concurrent chunk fetches while keeping every uncompressed asset < 500 KB (Pillar 1).
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
          maxInitialRequests: 8,
          maxAsyncRequests: 10,
          cacheGroups: {
            ...existingCacheGroups,
            shared: false,
          },
        };
      }
    }

    return config;
  },
};

export default nextConfig;
