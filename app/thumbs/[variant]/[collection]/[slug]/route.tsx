import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import { NextRequest, NextResponse } from 'next/server';
import {
  deriveMonogram,
  resolveContentTypeVisual,
} from '../../../../../lib/registry/content-type-registry';
import {
  getBookBySlug,
  getExamBySlug,
} from '../../../../../server/repositories/catalog-repository';

export const runtime = 'nodejs';

let cachedFontPromise: Promise<ArrayBuffer> | null = null;

function loadPlusJakartaBoldFont(): Promise<ArrayBuffer> {
  if (!cachedFontPromise) {
    const fontPath = path.join(
      process.cwd(),
      'assets',
      'fonts',
      'PlusJakartaSans-Bold.ttf'
    );
    cachedFontPromise = readFile(fontPath).then((buf) =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    );
  }
  return cachedFontPromise;
}

const IMMUTABLE_PNG_HEADERS: Record<string, string> = {
  'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
  Vary: 'Accept-Encoding',
};

const SITE_HUB_CARDS: Record<
  string,
  {
    title: string;
    subtitle: string;
    badgeLabel: string;
    monogram: string;
    bgHex: string;
    inkHex: string;
    footerRight: string;
  }
> = {
  home: {
    title: 'Verified Books, Question Banks & Mock Exam Series',
    subtitle: 'Instant syllabus previews · CBT mock tests · Unified study library',
    badgeLabel: 'CATALOG',
    monogram: 'ED',
    bgHex: '#0F766E',
    inkHex: '#FFFFFF',
    footerRight: 'exam-dash.com',
  },
  books: {
    title: 'Exam Books, Question Banks & Revision Guides',
    subtitle: 'Topic-wise eBooks · Solved papers · Free sample chapters',
    badgeLabel: 'BOOKS',
    monogram: 'BK',
    bgHex: '#1D4ED8',
    inkHex: '#FFFFFF',
    footerRight: 'Books Catalog',
  },
  exams: {
    title: 'Full-Length Online Mock Exams & CBT Test Series',
    subtitle: 'Timed practice sets · Detailed solutions · Performance analytics',
    badgeLabel: 'EXAMS',
    monogram: 'EX',
    bgHex: '#B45309',
    inkHex: '#FFFFFF',
    footerRight: 'Exam Series',
  },
  legal: {
    title: 'ExamDash Policies, Licensing & Learner Support',
    subtitle: 'Verified merchant compliance · Transparent terms & support',
    badgeLabel: 'POLICY',
    monogram: 'ED',
    bgHex: '#334155',
    inkHex: '#FFFFFF',
    footerRight: 'Official Policy',
  },
};

export async function GET(
  _req: NextRequest,
  context: {
    params: Promise<{ variant: string; collection: string; slug: string }>;
  }
) {
  const { variant, collection, slug: rawSlug } = await context.params;

  if (variant !== 'sq' && variant !== 'og') {
    return NextResponse.json(
      { error: 'Unsupported thumbnail variant. Expected sq or og.' },
      { status: 400, headers: { 'Cache-Control': 'public, s-maxage=60' } }
    );
  }

  const cleanSlug = decodeURIComponent(rawSlug || '').replace(/\.png$/i, '').trim();
  if (!cleanSlug) {
    return NextResponse.json(
      { error: 'Missing slug.' },
      { status: 404, headers: { 'Cache-Control': 'public, s-maxage=60' } }
    );
  }

  const normalizedCollection = collection.trim();
  if (normalizedCollection === 'site') {
    const hub = SITE_HUB_CARDS[cleanSlug.toLowerCase()];
    if (!hub) {
      return new NextResponse('Not Found', {
        status: 404,
        headers: {
          'Cache-Control': 'public, s-maxage=60',
          'X-Robots-Tag': 'noindex',
        },
      });
    }

    const fontData = await loadPlusJakartaBoldFont();
    if (variant === 'sq') {
      return new ImageResponse(
        (
          <div
            style={{
              width: '1200px',
              height: '1200px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: '76px',
              backgroundColor: hub.bgHex,
              color: hub.inkHex,
              fontFamily: 'Plus Jakarta Sans',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
              }}
            >
              <div style={{ fontSize: '34px', fontWeight: 700 }}>ExamDash</div>
              <div
                style={{
                  padding: '12px 26px',
                  borderRadius: '14px',
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  fontSize: '26px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                }}
              >
                {hub.badgeLabel}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
              }}
            >
              <div style={{ fontSize: '360px', fontWeight: 700, lineHeight: 1 }}>
                {hub.monogram}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                paddingTop: '36px',
                borderTop: '3px solid rgba(255,255,255,0.24)',
              }}
            >
              <div style={{ fontSize: '44px', fontWeight: 700, lineHeight: 1.2 }}>
                {hub.title}
              </div>
              <div style={{ fontSize: '26px', fontWeight: 700, opacity: 0.82 }}>
                {hub.subtitle}
              </div>
            </div>
          </div>
        ),
        {
          width: 1200,
          height: 1200,
          headers: IMMUTABLE_PNG_HEADERS,
          fonts: [
            {
              name: 'Plus Jakarta Sans',
              data: fontData,
              weight: 700,
              style: 'normal',
            },
          ],
        }
      );
    }

    return new ImageResponse(
      (
        <div
          style={{
            width: '1200px',
            height: '675px',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'stretch',
            backgroundColor: '#0B1120',
            color: '#F8FAFC',
            fontFamily: 'Plus Jakarta Sans',
            padding: '52px',
            gap: '52px',
          }}
        >
          <div
            style={{
              width: '420px',
              height: '571px',
              borderRadius: '32px',
              backgroundColor: hub.bgHex,
              color: hub.inkHex,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: '36px',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
              <div
                style={{
                  padding: '8px 18px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  fontSize: '20px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                }}
              >
                {hub.badgeLabel}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
              }}
            >
              <div style={{ fontSize: '188px', fontWeight: 700, lineHeight: 1 }}>
                {hub.monogram}
              </div>
            </div>
            <div style={{ fontSize: '20px', fontWeight: 700, opacity: 0.85 }}>
              exam-dash.com
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              flex: 1,
              paddingTop: '12px',
              paddingBottom: '12px',
            }}
          >
            <div style={{ fontSize: '26px', fontWeight: 700, color: '#38BDF8' }}>
              ExamDash Study Library
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ fontSize: '50px', fontWeight: 700, lineHeight: 1.16 }}>
                {hub.title}
              </div>
              <div style={{ fontSize: '25px', fontWeight: 700, color: '#94A3B8' }}>
                {hub.subtitle}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '24px',
                borderTop: '2px solid #1E293B',
                fontSize: '22px',
                fontWeight: 700,
                color: '#CBD5E1',
              }}
            >
              <span>ExamDash Official Platform</span>
              <span style={{ color: '#38BDF8' }}>{hub.footerRight}</span>
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 675,
        headers: IMMUTABLE_PNG_HEADERS,
        fonts: [
          {
            name: 'Plus Jakarta Sans',
            data: fontData,
            weight: 700,
            style: 'normal',
          },
        ],
      }
    );
  }

  const isBooks = normalizedCollection === 'books';
  const isExams =
    normalizedCollection === 'exams' ||
    normalizedCollection === 'ExamPackDocument';

  if (!isBooks && !isExams) {
    return NextResponse.json(
      { error: 'Unsupported collection.' },
      { status: 404, headers: { 'Cache-Control': 'public, s-maxage=60' } }
    );
  }

  const lookup = isBooks
    ? await getBookBySlug(cleanSlug)
    : await getExamBySlug(cleanSlug);

  if (lookup.status === 'deleted') {
    return new NextResponse('Gone', {
      status: 410,
      headers: {
        'Cache-Control': 'public, s-maxage=3600',
        'X-Robots-Tag': 'noindex',
      },
    });
  }

  if (lookup.status !== 'ok') {
    return new NextResponse('Not Found', {
      status: 404,
      headers: {
        'Cache-Control': 'public, s-maxage=60',
        'X-Robots-Tag': 'noindex',
      },
    });
  }

  const item = lookup.data;
  const visual = resolveContentTypeVisual(item.type, item.collectionName);
  const monogram = deriveMonogram(item.title);
  const fontData = await loadPlusJakartaBoldFont();

  const titleExcerpt =
    item.title.length > 76 ? `${item.title.slice(0, 73)}...` : item.title;
  const subtitleText =
    item.collectionName === 'ExamPackDocument'
      ? `${item.authorName} · ${item.totalMocktest} Mock ${
          item.totalMocktest === 1 ? 'Test' : 'Tests'
        } · ${item.language}`
      : `${item.authorName} · ${item.language}`;

  if (variant === 'sq') {
    return new ImageResponse(
      (
        <div
          style={{
            width: '1200px',
            height: '1200px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '76px',
            backgroundColor: visual.bgHex,
            color: visual.inkHex,
            fontFamily: 'Plus Jakarta Sans',
          }}
        >
          {/* Top Brand & Type Row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <div
              style={{
                fontSize: '34px',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                opacity: 0.9,
              }}
            >
              ExamDash
            </div>
            <div
              style={{
                padding: '12px 26px',
                borderRadius: '14px',
                backgroundColor:
                  visual.inkHex === '#FFFFFF'
                    ? 'rgba(255,255,255,0.18)'
                    : 'rgba(15,23,42,0.12)',
                fontSize: '26px',
                fontWeight: 700,
                letterSpacing: '0.08em',
              }}
            >
              {visual.badgeLabel}
            </div>
          </div>

          {/* Dominant 2-Letter Monogram */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
            }}
          >
            <div
              style={{
                fontSize: '360px',
                fontWeight: 700,
                letterSpacing: '-0.05em',
                lineHeight: 1,
              }}
            >
              {monogram}
            </div>
          </div>

          {/* Bottom Title & Author Footer */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              paddingTop: '36px',
              borderTop:
                visual.inkHex === '#FFFFFF'
                  ? '3px solid rgba(255,255,255,0.24)'
                  : '3px solid rgba(15,23,42,0.16)',
            }}
          >
            <div
              style={{
                fontSize: '44px',
                fontWeight: 700,
                lineHeight: 1.2,
                letterSpacing: '-0.02em',
              }}
            >
              {titleExcerpt}
            </div>
            <div
              style={{
                fontSize: '26px',
                fontWeight: 700,
                opacity: 0.78,
              }}
            >
              {subtitleText}
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 1200,
        headers: IMMUTABLE_PNG_HEADERS,
        fonts: [
          {
            name: 'Plus Jakarta Sans',
            data: fontData,
            weight: 700,
            style: 'normal',
          },
        ],
      }
    );
  }

  // 16:9 Discover & Social Card (1200 x 675)
  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '675px',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'stretch',
          backgroundColor: '#0B1120',
          color: '#F8FAFC',
          fontFamily: 'Plus Jakarta Sans',
          padding: '52px',
          gap: '52px',
        }}
      >
        {/* Left ContentTypeRegistry Monogram Block */}
        <div
          style={{
            width: '420px',
            height: '571px',
            borderRadius: '32px',
            backgroundColor: visual.bgHex,
            color: visual.inkHex,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '36px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              width: '100%',
            }}
          >
            <div
              style={{
                padding: '8px 18px',
                borderRadius: '10px',
                backgroundColor:
                  visual.inkHex === '#FFFFFF'
                    ? 'rgba(255,255,255,0.2)'
                    : 'rgba(15,23,42,0.12)',
                fontSize: '20px',
                fontWeight: 700,
                letterSpacing: '0.08em',
              }}
            >
              {visual.badgeLabel}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
            }}
          >
            <div
              style={{
                fontSize: '188px',
                fontWeight: 700,
                letterSpacing: '-0.05em',
                lineHeight: 1,
              }}
            >
              {monogram}
            </div>
          </div>

          <div
            style={{
              fontSize: '20px',
              fontWeight: 700,
              opacity: 0.8,
            }}
          >
            exam-dash.com
          </div>
        </div>

        {/* Right Editorial Title & Metadata */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 1,
            paddingTop: '12px',
            paddingBottom: '12px',
          }}
        >
          <div
            style={{
              fontSize: '26px',
              fontWeight: 700,
              color: visual.bgHex,
              letterSpacing: '0.02em',
            }}
          >
            ExamDash Study Library
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
            }}
          >
            <div
              style={{
                fontSize: '52px',
                fontWeight: 700,
                lineHeight: 1.16,
                letterSpacing: '-0.025em',
                color: '#F8FAFC',
              }}
            >
              {titleExcerpt}
            </div>
            <div
              style={{
                fontSize: '26px',
                fontWeight: 700,
                color: '#94A3B8',
              }}
            >
              {subtitleText}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: '24px',
              borderTop: '2px solid #1E293B',
              fontSize: '22px',
              fontWeight: 700,
              color: '#CBD5E1',
            }}
          >
            <span>Verified Digital Edition</span>
            <span style={{ color: visual.bgHex }}>
              {item.buyPrice === 0
                ? 'Free Access'
                : `${item.currency || 'INR'} ${item.buyPrice}`}
            </span>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 675,
      headers: IMMUTABLE_PNG_HEADERS,
      fonts: [
        {
          name: 'Plus Jakarta Sans',
          data: fontData,
          weight: 700,
          style: 'normal',
        },
      ],
    }
  );
}
