import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import {
  LegalDocumentShell,
  type LegalTocItem,
} from '../../components/legal/legal-document-shell';
import { BUSINESS_INFO } from '../../lib/legal/business-info';
import { buildCanonicalAlternates, buildSiteOgUrl } from '../../lib/seo/schema';

const PAGE_TITLE = 'License Agreement';
const PAGE_DESC =
  'End-User License Agreement (EULA) governing personal study rights, content usage restrictions, and copyright ownership for Exam Kart (Pardeep Kumar) digital eBooks and mock test packs.';

export const metadata: Metadata = {
  title: `${PAGE_TITLE} — ${BUSINESS_INFO.brandName}`,
  description: PAGE_DESC,
  alternates: buildCanonicalAlternates('/license-agreement'),
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: `${PAGE_TITLE} — ${BUSINESS_INFO.brandName}`,
    description: PAGE_DESC,
    url: `${BUSINESS_INFO.officialWebsiteOrigin}/license-agreement`,
    type: 'website',
    images: [
      {
        url: buildSiteOgUrl(),
        width: 512,
        height: 512,
        alt: `${PAGE_TITLE} — ${BUSINESS_INFO.brandName}`,
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: `${PAGE_TITLE} — ${BUSINESS_INFO.brandName}`,
    description: PAGE_DESC,
    images: [buildSiteOgUrl()],
  },
};

const TOC: LegalTocItem[] = [
  { id: 'parties', label: 'Parties & Licensed Materials' },
  { id: 'grant-of-license', label: 'Grant of Personal Study License' },
  { id: 'sample-license', label: 'Free Samples & Preview Extracts' },
  { id: 'restrictions', label: 'Strictly Prohibited Uses' },
  { id: 'ownership', label: 'Copyright & Ownership Retention' },
  { id: 'term-termination', label: 'License Duration & Revocation' },
  { id: 'institutional-licensing', label: 'Institutional & Coaching Licenses' },
  { id: 'governing-law', label: 'Governing Law & Enforcement' },
];

export default function LicenseAgreementPage() {
  return (
    <LegalDocumentShell
      currentPath="/license-agreement"
      title={PAGE_TITLE}
      description={PAGE_DESC}
      toc={TOC}
    >
      <section id="parties" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          01. Parties &amp; Licensed Materials
        </h2>
        <p>
          This End-User License Agreement (&ldquo;License Agreement&rdquo;) is a
          legal contract between you (&ldquo;Licensee&rdquo;) and{' '}
          <strong>{BUSINESS_INFO.legalName}</strong>, operating under the brand{' '}
          <strong>{BUSINESS_INFO.brandName}</strong> via{' '}
          <a
            href={BUSINESS_INFO.officialWebsite}
            className="underline underline-offset-4 font-medium"
          >
            {BUSINESS_INFO.officialWebsite}
          </a>{' '}
          (&ldquo;Licensor&rdquo;). It governs your access to and use of all
          digital eBooks, PDF/Markdown study modules, chapter-wise question
          banks, quizbooks, computer-based mock exam packs, answer explanations,
          and platform software (&ldquo;Licensed Content&rdquo;).
        </p>
      </section>

      <section id="grant-of-license" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          02. Grant of Personal Study License
        </h2>
        <p>
          Upon verified payment through Razorpay (or verified claim of a ₹0 free
          item), Licensor grants you a{' '}
          <strong>
            limited, personal, non-exclusive, non-transferable,
            non-sublicensable, and revocable license
          </strong>{' '}
          to:
        </p>
        <ul className="list-disc ps-5 space-y-2">
          <li>
            Access, read, and practice the purchased Licensed Content strictly
            within the official {BUSINESS_INFO.brandName} / ExamDash web
            platform and authorized companion mobile applications.
          </li>
          <li>
            Use the Licensed Content solely for your own personal,
            non-commercial academic and competitive examination preparation.
          </li>
          <li>
            View your personal attempt history, analytics reports, and solution
            reviews associated with your authenticated account.
          </li>
        </ul>
      </section>

      <section id="sample-license" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          03. Free Samples &amp; Preview Extracts
        </h2>
        <p>
          Publicly accessible syllabus tables and free sample book extracts are
          licensed strictly for personal evaluation prior to purchase. Free
          samples remain fully protected by copyright and may not be republished,
          mirrored on external websites, or bundled into third-party study packs
          without written authorization from {BUSINESS_INFO.legalName}.
        </p>
      </section>

      <section id="restrictions" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          04. Strictly Prohibited Uses
        </h2>
        <p>
          Except as expressly permitted by applicable Indian copyright law, you
          shall NOT directly or indirectly:
        </p>
        <ul className="list-disc ps-5 space-y-2">
          <li>
            <strong>Redistribute or Resell:</strong> Sell, rent, lease, lend,
            sublicense, broadcast, or upload any part of the Licensed Content to
            Telegram channels, WhatsApp groups, Google Drive links, YouTube
            videos, or piracy portals.
          </li>
          <li>
            <strong>Commercial Teaching / Classroom Use:</strong> Project,
            photocopy, print, or distribute our eBooks or mock test questions to
            students in a coaching institute, tuition center, or commercial
            course without a separate institutional license.
          </li>
          <li>
            <strong>Circumvent Access Controls:</strong> Strip watermarks,
            capture bulk screenshots/screen recordings, extract raw PDF/JSON
            streams, reverse-engineer the CBT engine, or bypass signed delivery
            URLs.
          </li>
          <li>
            <strong>Automated Extraction &amp; Dataset Harvesting:</strong> Use
            crawlers, scripts, or scraping tools to extract question banks or
            compile datasets for competing test-prep platforms or AI model
            training.
          </li>
          <li>
            <strong>Account Sharing:</strong> Share your registered account
            credentials with other individuals to give multiple users access to
            a single-seat license.
          </li>
        </ul>
      </section>

      <section id="ownership" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          05. Copyright &amp; Ownership Retention
        </h2>
        <p>
          All Licensed Content is licensed, not sold.{' '}
          <strong>
            {BUSINESS_INFO.legalName} ({BUSINESS_INFO.brandName})
          </strong>{' '}
          and its respective authors and publishers retain all right, title, and
          intellectual property interest in the text, question formulations,
          mathematical diagrams, explanations, metadata, trade names, and
          platform software. No implied licenses are granted under this
          agreement.
        </p>
      </section>

      <section id="term-termination" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          06. License Duration, Updates &amp; Revocation
        </h2>
        <p>
          Your license remains valid for the stated validity period of the
          specific eBook or mock exam pack (or for the active life of your
          account where no fixed expiry is listed on the product page). Licensor
          may release errata fixes, syllabus updates, or reader improvements to
          keep content accurate.
        </p>
        <p>
          This license terminates automatically and without refund if you commit
          a material breach of Section 04 (including piracy, unauthorized
          redistribution, or fraudulent chargebacks), or if you voluntarily
          delete your account.
        </p>
      </section>

      <section id="institutional-licensing" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          07. Institutional &amp; Bulk Licensing
        </h2>
        <p>
          Schools, colleges, libraries, and coaching institutes seeking
          multi-seat access or white-label permissions for {BUSINESS_INFO.brandName}{' '}
          publications must obtain a written commercial license. Please write to{' '}
          <a
            href={`mailto:${BUSINESS_INFO.supportEmail}`}
            className="underline underline-offset-4 font-medium"
          >
            {BUSINESS_INFO.supportEmail}
          </a>{' '}
          with your institution details and estimated seat count.
        </p>
      </section>

      <section id="governing-law" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          08. Governing Law &amp; Enforcement
        </h2>
        <p>
          This License Agreement is governed by the laws of India, including the
          Copyright Act, 1957 and the Information Technology Act, 2000. Any
          dispute arising hereunder shall be subject to the exclusive
          jurisdiction of the courts at{' '}
          <strong>{BUSINESS_INFO.jurisdiction}</strong>. Unauthorized
          reproduction or commercial piracy may result in civil injunctive
          relief and statutory damages. For licensing queries, please visit our{' '}
          <Link
            href="/contact-us"
            prefetch={false}
            className="underline underline-offset-4 font-medium"
          >
            Contact Us
          </Link>{' '}
          page.
        </p>
      </section>
    </LegalDocumentShell>
  );
}
