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
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  output: 'standalone',
  outputFileTracingIncludes: {
    '/thumbs/[variant]/[collection]/[slug]': ['./assets/fonts/**/*'],
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
      ...(isProd
        ? [
            {
              source: '/_next/static/:path*',
              headers: [
                {
                  key: 'Cache-Control',
                  value: 'public, max-age=31536000, immutable',
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
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
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
    }

    return config;
  },
};

export default nextConfig;
