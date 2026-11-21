import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono, Source_Serif_4 } from 'next/font/google';
import './globals.css';
import { AppProviders } from '../features/shell/providers';
import {
  buildSiteGraphJsonLd,
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
    canonical: getCanonicalOrigin(),
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
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESC,
    url: getCanonicalOrigin(),
    siteName: 'ExamDash',
    type: 'website',
    images: [
      {
        url: `${getCanonicalOrigin()}/pwa-512x512.png`,
        width: 512,
        height: 512,
        alt: 'ExamDash',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESC,
    images: [`${getCanonicalOrigin()}/pwa-512x512.png`],
  },
};

// < 600B synchronous pre-paint theme script syncing .dark, color-scheme, and <meta name="theme-color"> (#0B1120 / #F8FAFC)
const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('ed-theme'),d=s?s==='dark':matchMedia('(prefers-color-scheme:dark)').matches,r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=d?'#0B1120':'#F8FAFC';}catch(e){}})();`;

// Speculation Rules for instant MPA transitions (excluding /api/* and authenticated routes)
const SPECULATION_RULES_JSON = JSON.stringify({
  prerender: [
    {
      where: {
        and: [
          { href_matches: '/*' },
          { not: { href_matches: '/api/*' } },
          { not: { href_matches: '/purchased*' } },
          { not: { href_matches: '/read/*' } },
          { not: { href_matches: '/attempt/*' } },
        ],
      },
      eagerness: 'moderate',
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
        <meta name="theme-color" content="#F8FAFC" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script
          type="speculationrules"
          dangerouslySetInnerHTML={{ __html: SPECULATION_RULES_JSON }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: siteJsonLd }}
        />
      </head>
      <body suppressHydrationWarning className="font-sans antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
