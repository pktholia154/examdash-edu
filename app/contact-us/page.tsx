import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import {
  LegalDocumentShell,
  type LegalTocItem,
} from '../../components/legal/legal-document-shell';
import { BUSINESS_INFO } from '../../lib/legal/business-info';
import { buildCanonicalAlternates, buildSiteOgUrl } from '../../lib/seo/schema';
import { ContactSupportComposer } from '../../features/legal/contact-support-composer';

const PAGE_TITLE = 'Contact Us';
const PAGE_DESC =
  'Official customer support, Razorpay billing assistance, grievance redressal officer, and verified Bhiwani office address for Exam Kart (operated by Pardeep Kumar).';

export const metadata: Metadata = {
  title: `${PAGE_TITLE} — ${BUSINESS_INFO.brandName}`,
  description: PAGE_DESC,
  alternates: buildCanonicalAlternates('/contact-us'),
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: `${PAGE_TITLE} — ${BUSINESS_INFO.brandName}`,
    description: PAGE_DESC,
    url: `${BUSINESS_INFO.officialWebsiteOrigin}/contact-us`,
    type: 'website',
    images: [
      {
        url: buildSiteOgUrl('legal'),
        width: 1200,
        height: 675,
        alt: `${PAGE_TITLE} — ${BUSINESS_INFO.brandName}`,
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${PAGE_TITLE} — ${BUSINESS_INFO.brandName}`,
    description: PAGE_DESC,
    images: [buildSiteOgUrl('legal')],
  },
};

const TOC: LegalTocItem[] = [
  { id: 'merchant-identity', label: 'Verified Business & Contact Details' },
  { id: 'support-composer', label: 'Send a Support or Billing Inquiry' },
  { id: 'payment-help', label: 'Payment, Order & Refund Help Guide' },
  { id: 'grievance-redressal', label: 'Grievance Redressal & Support Hours' },
];

export default function ContactUsPage() {
  return (
    <LegalDocumentShell
      currentPath="/contact-us"
      title={PAGE_TITLE}
      description={PAGE_DESC}
      categoryLabel="Merchant Support & Grievance Desk"
      pageType="ContactPage"
      toc={TOC}
    >
      {/* Section 01: Complete Verified Business Identity for Razorpay Verification */}
      <section id="merchant-identity" className="scroll-mt-24 space-y-4">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          01. Verified Business &amp; Merchant Contact Details
        </h2>
        <p>
          You can reach the official customer support, billing, and compliance
          desk for <strong>{BUSINESS_INFO.brandName}</strong> using the verified
          business details below:
        </p>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 text-sm">
          <div>
            <dt className="text-xs font-medium text-[var(--text-muted)]">
              Legal Name
            </dt>
            <dd className="mt-1 font-bold text-[var(--text-main)]">
              {BUSINESS_INFO.legalName}
            </dd>
          </div>

          <div>
            <dt className="text-xs font-medium text-[var(--text-muted)]">
              Brand Name
            </dt>
            <dd className="mt-1 font-bold text-[var(--text-main)]">
              {BUSINESS_INFO.brandName}
            </dd>
          </div>

          <div>
            <dt className="text-xs font-medium text-[var(--text-muted)]">
              Support Email
            </dt>
            <dd className="mt-1 font-semibold text-[var(--text-main)]">
              <a
                href={`mailto:${BUSINESS_INFO.supportEmail}`}
                className="underline underline-offset-4 hover:opacity-80"
              >
                {BUSINESS_INFO.supportEmail}
              </a>
            </dd>
          </div>

          <div>
            <dt className="text-xs font-medium text-[var(--text-muted)]">
              Official Website
            </dt>
            <dd className="mt-1 font-semibold text-[var(--text-main)]">
              <a
                href={BUSINESS_INFO.officialWebsite}
                className="underline underline-offset-4 hover:opacity-80"
              >
                {BUSINESS_INFO.officialWebsite}
              </a>
            </dd>
          </div>

          <div className="sm:col-span-2 pt-4 border-t border-[var(--border-subtle)]">
            <dt className="text-xs font-medium text-[var(--text-muted)]">
              Registered Office Address
            </dt>
            <dd className="mt-1 font-semibold text-[var(--text-main)] leading-relaxed">
              {BUSINESS_INFO.officeAddress}
            </dd>
          </div>

          <div>
            <dt className="text-xs font-medium text-[var(--text-muted)]">
              Support Working Hours
            </dt>
            <dd className="mt-1 text-[var(--text-main)]">
              {BUSINESS_INFO.supportHours}
            </dd>
          </div>

          <div>
            <dt className="text-xs font-medium text-[var(--text-muted)]">
              Typical Email Response Time
            </dt>
            <dd className="mt-1 text-[var(--text-main)]">
              {BUSINESS_INFO.responseSla}
            </dd>
          </div>
        </dl>
      </section>

      {/* Section 02: Interactive Support Email Builder & Quick Copy */}
      <section id="support-composer" className="scroll-mt-24 space-y-4">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          02. Send a Support or Billing Inquiry
        </h2>
        <ContactSupportComposer />
      </section>

      {/* Section 03: Fast Resolution Checklist for Razorpay / Digital Orders */}
      <section id="payment-help" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          03. Payment, Order &amp; Refund Assistance Guide
        </h2>
        <p>
          To help us resolve payment, unlock, or refund inquiries on the first
          reply, please include the following details when writing to{' '}
          <a
            href={`mailto:${BUSINESS_INFO.supportEmail}`}
            className="underline underline-offset-4 font-medium"
          >
            {BUSINESS_INFO.supportEmail}
          </a>
          :
        </p>
        <ul className="list-disc ps-5 space-y-2">
          <li>
            <strong>Payment Deducted / Item Not Unlocked:</strong> Include your
            registered account email, Razorpay Payment ID (starts with{' '}
            <span className="font-mono text-xs">pay_</span>), transaction date,
            and exact amount debited.
          </li>
          <li>
            <strong>Duplicate Payment or Refund Claim:</strong> Review our{' '}
            <Link
              href="/refund-cancellation-policy"
              prefetch={false}
              className="underline underline-offset-4 font-medium"
            >
              Refund &amp; Cancellation Policy
            </Link>{' '}
            and attach both Razorpay Payment IDs or UPI UTR references within{' '}
            {BUSINESS_INFO.refundClaimWindow}.
          </li>
          <li>
            <strong>Technical or Reader Issues:</strong> Mention the eBook or
            Mock Exam title, your browser/device type (Android, iOS, or
            Desktop), and a brief summary of what occurred.
          </li>
          <li>
            <strong>Account Privacy or Deletion Requests:</strong> Write from
            your registered email address or use the instant self-serve Delete
            Account control in the top-right account menu.
          </li>
        </ul>
      </section>

      {/* Section 04: Grievance Redressal Officer */}
      <section id="grievance-redressal" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          04. Grievance Redressal Officer
        </h2>
        <p>
          For formal consumer complaints, data privacy concerns under the
          Information Technology Act, 2000 / DPDP Act, 2023, or escalated
          payment grievances, please address correspondence to:
        </p>
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 text-sm space-y-1">
          <p className="font-bold text-[var(--text-main)]">
            {BUSINESS_INFO.legalName} — Grievance Officer ({BUSINESS_INFO.brandName})
          </p>
          <p className="text-[var(--text-muted)]">{BUSINESS_INFO.officeAddress}</p>
          <p className="text-[var(--text-muted)]">
            Email:{' '}
            <a
              href={`mailto:${BUSINESS_INFO.supportEmail}`}
              className="text-[var(--text-main)] font-medium underline underline-offset-4"
            >
              {BUSINESS_INFO.supportEmail}
            </a>{' '}
            · Website:{' '}
            <a
              href={BUSINESS_INFO.officialWebsite}
              className="text-[var(--text-main)] font-medium underline underline-offset-4"
            >
              {BUSINESS_INFO.officialWebsite}
            </a>
          </p>
        </div>
      </section>
    </LegalDocumentShell>
  );
}
