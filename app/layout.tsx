import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { AppProviders } from '../features/shell/providers';
import {
  buildSiteGraphJsonLd,
  buildSiteOgUrl,
  getCanonicalOrigin,
  serializeSafeJsonLd,
} from '../lib/seo/schema';

const plusJakarta = localFont({
  src: '../assets/fonts/PlusJakartaSans-Variable.woff2',
  display: 'swap',
  preload: true,
  variable: '--font-sans',
  weight: '400 800',
  adjustFontFallback: 'Arial',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
});

const sourceSerif = localFont({
  src: '../assets/fonts/SourceSerif4-Variable.woff2',
  display: 'swap',
  preload: false,
  variable: '--font-serif',
  weight: '400 700',
  adjustFontFallback: 'Times New Roman',
  fallback: ['Charter', 'Cambria', 'Georgia', 'serif'],
});

const jetbrainsMono = localFont({
  src: '../assets/fonts/JetBrainsMono-Variable.woff2',
  display: 'swap',
  preload: false,
  variable: '--font-mono',
  weight: '400 600',
  adjustFontFallback: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'monospace'],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F0F0F0' },
    { media: '(prefers-color-scheme: dark)', color: '#141514' },
  ],
};

const SITE_TITLE = 'ExamDash — Books, Mock Exams & Study Library';
const SITE_DESC =
  'Discover curated ebooks, quizbooks, and full-length mock exam packs with instant syllabus previews and unified study library access.';

export const metadata: Metadata = {
  metadataBase: new URL('https://exam-dash.com'),
  title: {
    default: SITE_TITLE,
    template: '%s | ExamDash',
  },
  description: SITE_DESC,
  alternates: {
    types: {
      'application/rss+xml': 'https://exam-dash.com/feed.xml',
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ExamDash',
  },
  icons: {
    icon: [
      {
        url: '/app-icons/favicon-32.png?v=ef0c6c39',
        sizes: '32x32',
        type: 'image/png',
      },
      {
        url: '/app-icons/icon-192.png?v=ef0c6c39',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        url: '/app-icons/icon-512.png?v=ef0c6c39',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    shortcut: [
      {
        url: '/app-icons/icon-192.png?v=ef0c6c39',
        sizes: '192x192',
        type: 'image/png',
      },
    ],
    apple: [
      {
        url: '/app-icons/apple-touch-icon.png?v=ef0c6c39',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
    other: [
      {
        rel: 'apple-touch-icon-precomposed',
        url: '/app-icons/apple-touch-icon.png?v=ef0c6c39',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESC,
    url: getCanonicalOrigin(),
    siteName: 'ExamDash',
    type: 'website',
    images: [
      {
        url: buildSiteOgUrl(),
        width: 512,
        height: 512,
        alt: 'ExamDash — Verified Books, Question Banks & Mock Exam Packs',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: SITE_TITLE,
    description: SITE_DESC,
    images: [buildSiteOgUrl()],
  },
};

// < 400B synchronous pre-paint theme + early beforeinstallprompt capture script (zero DOM attribute mutations beyond .dark)
const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('ed-theme'),d=s?s==='dark':matchMedia('(prefers-color-scheme:dark)').matches;document.documentElement.classList.toggle('dark',d);window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__edBip=e;window.dispatchEvent(new Event('ed-bip-ready'));});}catch(e){}})();`;

// Speculation Rules: pointerdown/click prefetch only (zero background WRS chunk fetches; instant on user tap/click)
const SPECULATION_RULES_JSON = JSON.stringify({
  prefetch: [
    {
      where: {
        and: [
          { href_matches: '/*' },
          { not: { href_matches: '/api/*' } },
          { not: { href_matches: '/purchased*' } },
          { not: { href_matches: '/profile*' } },
          { not: { href_matches: '/search*' } },
          { not: { href_matches: '/read/*' } },
          { not: { href_matches: '/attempt/*' } },
          { not: { href_matches: '/admin/*' } },
          { not: { href_matches: '/account/*' } },
          { not: { href_matches: '/checkout/*' } },
          { not: { selector_matches: '[target="_blank"]' } },
          { not: { selector_matches: '[rel~="nofollow"]' } },
        ],
      },
      eagerness: 'conservative',
    },
  ],
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const siteJsonLd = serializeSafeJsonLd(buildSiteGraphJsonLd());

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plusJakarta.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <link
          rel="manifest"
          href="/manifest.webmanifest?v=ef0c6c39"
          crossOrigin="use-credentials"
        />
      </head>
      <body suppressHydrationWarning className="font-sans antialiased">
        <script
          key="ed-theme-init"
          id="ed-theme-init"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <script
          key="ed-speculation-rules"
          id="ed-speculation-rules"
          type="speculationrules"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: SPECULATION_RULES_JSON }}
        />
        <script
          key="ed-site-jsonld"
          id="ed-site-jsonld"
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: siteJsonLd }}
        />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
