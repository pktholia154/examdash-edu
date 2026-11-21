import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import {
  LegalDocumentShell,
  type LegalTocItem,
} from '../../components/legal/legal-document-shell';
import { BUSINESS_INFO } from '../../lib/legal/business-info';

const PAGE_TITLE = 'Privacy Policy';
const PAGE_DESC =
  'Learn how Exam Kart (operated by Pardeep Kumar) collects, secures, and processes learner account data, study records, and Razorpay payment verification metadata on https://exam-dash.com/.';

export const metadata: Metadata = {
  title: `${PAGE_TITLE} — ${BUSINESS_INFO.brandName}`,
  description: PAGE_DESC,
  alternates: {
    canonical: '/privacy-policy',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: `${PAGE_TITLE} — ${BUSINESS_INFO.brandName}`,
    description: PAGE_DESC,
    url: `${BUSINESS_INFO.officialWebsiteOrigin}/privacy-policy`,
    type: 'website',
  },
};

const TOC: LegalTocItem[] = [
  { id: 'overview', label: 'Scope & Legal Entity' },
  { id: 'information-collected', label: 'Information We Collect' },
  { id: 'razorpay-payments', label: 'Payment Processing & Razorpay Security' },
  { id: 'how-we-use-data', label: 'How We Use Your Information' },
  { id: 'cookies-storage', label: 'Cookies & Local Browser Storage' },
  { id: 'data-sharing', label: 'Data Sharing & Third-Party Processors' },
  { id: 'data-retention-security', label: 'Retention & Security Safeguards' },
  { id: 'user-rights', label: 'Your Privacy Rights & Account Deletion' },
  { id: 'grievance-officer', label: 'Grievance Officer & Contact Details' },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalDocumentShell
      currentPath="/privacy-policy"
      title={PAGE_TITLE}
      description={PAGE_DESC}
      toc={TOC}
    >
      <section id="overview" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          01. Scope &amp; Legal Entity
        </h2>
        <p>
          This Privacy Policy explains how{' '}
          <strong>{BUSINESS_INFO.legalName}</strong>, operating under the brand
          name <strong>{BUSINESS_INFO.brandName}</strong> through the official
          website{' '}
          <a
            href={BUSINESS_INFO.officialWebsite}
            className="underline underline-offset-4 font-medium"
          >
            {BUSINESS_INFO.officialWebsite}
          </a>{' '}
          and associated digital study applications (&ldquo;Platform&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;), collects,
          uses, stores, and protects personal information of learners and
          visitors (&ldquo;you&rdquo; or &ldquo;User&rdquo;).
        </p>
        <p>
          This policy is published in compliance with the Information Technology
          Act, 2000, the Information Technology (Reasonable Security Practices
          and Procedures and Sensitive Personal Data or Information) Rules,
          2011, and the Digital Personal Data Protection Act, 2023 (DPDP Act) of
          India. By accessing the Platform, creating an account, or completing a
          purchase, you agree to the practices described in this policy.
        </p>
      </section>

      <section id="information-collected" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          02. Information We Collect
        </h2>
        <p>
          We collect only the minimum personal and operational information
          necessary to authenticate your account, verify purchases, and deliver
          purchased digital eBooks, question banks, and mock test series:
        </p>
        <ul className="list-disc ps-5 space-y-2 text-[var(--text-main)]">
          <li>
            <strong>Account &amp; Identity Information:</strong> Full name,
            email address, and authentication identifier provided when you sign
            in via Google Sign-In / Firebase Authentication.
          </li>
          <li>
            <strong>Order &amp; Transaction Metadata:</strong> Purchased item
            identifiers, order amount, currency (INR), transaction timestamp,
            and gateway verification references (Razorpay Order ID and Razorpay
            Payment ID).
          </li>
          <li>
            <strong>Learning &amp; Assessment Records:</strong> Mock exam
            attempt responses, scores, bookmark positions, and reading progress
            stored to synchronize your Study Library across sessions.
          </li>
          <li>
            <strong>Technical &amp; Diagnostic Logs:</strong> IP address,
            browser user-agent, device viewport class, and error logs used
            strictly for fraud prevention, access control, and platform
            reliability.
          </li>
        </ul>
      </section>

      <section id="razorpay-payments" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          03. Payment Processing &amp; Razorpay Security
        </h2>
        <p>
          All paid transactions on{' '}
          <strong>{BUSINESS_INFO.brandName}</strong> (
          {BUSINESS_INFO.officialWebsite}) are processed securely through{' '}
          <strong>Razorpay Software Private Limited</strong> (&ldquo;Razorpay&rdquo;),
          a PCI-DSS Level 1 compliant payment gateway regulated in India.
        </p>
        <ul className="list-disc ps-5 space-y-2">
          <li>
            <strong>No Card or Banking Credential Storage:</strong>{' '}
            {BUSINESS_INFO.legalName} / {BUSINESS_INFO.brandName} does{' '}
            <strong>not</strong> collect, process, or store your credit/debit
            card numbers, CVV, expiry dates, UPI PINs, or net-banking passwords
            on our servers. All sensitive payment instruments are entered
            directly inside Razorpay&rsquo;s encrypted checkout interface.
          </li>
          <li>
            <strong>Cryptographic Verification:</strong> Upon completion of a
            payment, Razorpay returns a Payment ID, Order ID, and HMAC-SHA256
            signature which our backend verifies server-side before unlocking
            digital study materials in your Purchased Library.
          </li>
          <li>
            Your financial information is also governed by Razorpay&rsquo;s own
            Privacy Policy and applicable Reserve Bank of India (RBI)
            tokenization and security mandates.
          </li>
        </ul>
      </section>

      <section id="how-we-use-data" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          04. How We Use Your Information
        </h2>
        <ul className="list-disc ps-5 space-y-2">
          <li>
            Create and authenticate your learner profile and protect your
            Purchased Library from unauthorized access.
          </li>
          <li>
            Verify Razorpay payment confirmations and grant instant electronic
            access to purchased eBooks, question banks, and CBT mock tests.
          </li>
          <li>
            Issue transaction confirmations, respond to billing or refund
            inquiries, and resolve technical support tickets sent to{' '}
            <a
              href={`mailto:${BUSINESS_INFO.supportEmail}`}
              className="underline underline-offset-4 font-medium"
            >
              {BUSINESS_INFO.supportEmail}
            </a>
            .
          </li>
          <li>
            Prevent duplicate charges, unauthorized content scraping, account
            sharing abuse, and payment fraud.
          </li>
          <li>
            Comply with Indian tax, accounting, and statutory recordkeeping
            obligations.
          </li>
        </ul>
      </section>

      <section id="cookies-storage" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          05. Cookies &amp; Local Browser Storage
        </h2>
        <p>
          Our public catalog pages operate on a privacy-first, zero-ad-cookie
          architecture. We do not sell behavioral profiles or deploy third-party
          advertising trackers. Local browser storage (
          <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-[var(--bg-elevated)]">
            localStorage
          </code>{' '}
          and{' '}
          <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-[var(--bg-elevated)]">
            IndexedDB
          </code>
          ) is used strictly for essential functionality: remembering your
          light/dark theme preference, maintaining shopping cart selections,
          preserving mock test timer state, and securely storing authentication
          session tokens. Razorpay may set strictly necessary fraud-prevention
          cookies only when you open the checkout modal.
        </p>
      </section>

      <section id="data-sharing" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          06. Data Sharing &amp; Third-Party Processors
        </h2>
        <p>
          We never sell, rent, or trade your personal information to marketers
          or data brokers. We share limited data strictly with vetted
          infrastructure processors under contractual confidentiality:
        </p>
        <ul className="list-disc ps-5 space-y-2">
          <li>
            <strong>Razorpay Software Private Limited:</strong> Payment
            processing, UPI/card authorization, fraud screening, and refund
            settlements.
          </li>
          <li>
            <strong>Google Cloud / Firebase:</strong> User authentication,
            encrypted cloud database hosting, and signed digital content
            delivery.
          </li>
          <li>
            <strong>Legal &amp; Regulatory Authorities:</strong> Only when
            strictly required by a valid court order, law enforcement request,
            or statutory audit under Indian law.
          </li>
        </ul>
      </section>

      <section id="data-retention-security" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          07. Retention &amp; Security Safeguards
        </h2>
        <p>
          We protect data in transit using HTTPS/TLS encryption and enforce
          strict server-side authentication and authorization checks before
          serving gated study assets via short-lived signed delivery streams.
          Account data is retained while your account remains active. Financial
          transaction logs (Order ID, Payment ID, invoice amount, and date) may
          be retained for up to 8 financial years where required by Indian
          accounting and tax laws even after account deletion.
        </p>
      </section>

      <section id="user-rights" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          08. Your Privacy Rights &amp; Account Deletion
        </h2>
        <p>
          Under India&rsquo;s DPDP Act, 2023 and applicable privacy laws, you
          have the right to access, correct, or request erasure of your personal
          data. You can permanently delete your account at any time using the
          self-serve <strong>Delete Account</strong> option in the signed-in
          account menu, or by sending an erasure request from your registered
          email to{' '}
          <a
            href={`mailto:${BUSINESS_INFO.supportEmail}`}
            className="underline underline-offset-4 font-medium"
          >
            {BUSINESS_INFO.supportEmail}
          </a>
          . Please note that deleting your account permanently revokes access to
          previously unlocked digital items linked to that profile.
        </p>
      </section>

      <section id="grievance-officer" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          09. Grievance Officer &amp; Contact Details
        </h2>
        <p>
          In accordance with the Information Technology Act, 2000 and DPDP Act,
          2023, any privacy questions, data correction requests, or grievances
          may be directed to our designated Grievance Officer:
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 text-sm">
          <div>
            <dt className="text-xs text-[var(--text-muted)]">
              Grievance Officer / Legal Name
            </dt>
            <dd className="mt-0.5 font-semibold text-[var(--text-main)]">
              {BUSINESS_INFO.legalName}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--text-muted)]">Brand Name</dt>
            <dd className="mt-0.5 font-semibold text-[var(--text-main)]">
              {BUSINESS_INFO.brandName}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--text-muted)]">Email</dt>
            <dd className="mt-0.5 font-semibold text-[var(--text-main)]">
              <a
                href={`mailto:${BUSINESS_INFO.supportEmail}`}
                className="underline underline-offset-4"
              >
                {BUSINESS_INFO.supportEmail}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--text-muted)]">Response SLA</dt>
            <dd className="mt-0.5 font-medium text-[var(--text-main)]">
              Acknowledgement within 48 hours; resolution within 15–30 days
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-[var(--text-muted)]">Office Address</dt>
            <dd className="mt-0.5 font-medium text-[var(--text-main)]">
              {BUSINESS_INFO.officeAddress}
            </dd>
          </div>
        </dl>
        <p className="text-sm text-[var(--text-muted)]">
          For related policies, please also review our{' '}
          <Link
            href="/terms-of-service"
            className="text-[var(--text-main)] underline underline-offset-4"
          >
            Terms of Service
          </Link>
          ,{' '}
          <Link
            href="/refund-cancellation-policy"
            className="text-[var(--text-main)] underline underline-offset-4"
          >
            Refund &amp; Cancellation Policy
          </Link>
          , and{' '}
          <Link
            href="/contact-us"
            className="text-[var(--text-main)] underline underline-offset-4"
          >
            Contact Us
          </Link>{' '}
          page.
        </p>
      </section>
    </LegalDocumentShell>
  );
}
