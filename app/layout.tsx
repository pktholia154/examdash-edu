import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono, Source_Serif_4 } from 'next/font/google';
import './globals.css';
import { AppProviders } from '../features/shell/providers';
import {
  buildSiteGraphJsonLd,
  buildSiteOgUrl,
  getCanonicalOrigin,
  serializeSafeJsonLd,
} from '../lib/seo/schema';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  weight: ['400', '500', '600', '700', '800'],
});

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-serif',
  weight: ['400', '600', '700'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-mono',
  weight: ['400', '500', '600'],
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
  metadataBase: new URL(getCanonicalOrigin()),
  title: {
    default: SITE_TITLE,
    template: '%s | ExamDash',
  },
  description: SITE_DESC,
  alternates: {
    types: {
      'application/rss+xml': `${getCanonicalOrigin()}/feed.xml`,
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
        url: buildSiteOgUrl('home'),
        width: 1200,
        height: 675,
        alt: 'ExamDash — Verified Books, Question Banks & Mock Exam Packs',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESC,
    images: [buildSiteOgUrl('home')],
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
