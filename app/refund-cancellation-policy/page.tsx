import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import {
  LegalDocumentShell,
  type LegalTocItem,
} from '../../components/legal/legal-document-shell';
import { BUSINESS_INFO } from '../../lib/legal/business-info';

const PAGE_TITLE = 'Refund & Cancellation Policy';
const PAGE_DESC =
  'Clear cancellation rules, digital product refund eligibility criteria, duplicate payment reversal procedures, and 5–7 business day Razorpay refund timelines for Exam Kart (Pardeep Kumar).';

export const metadata: Metadata = {
  title: `${PAGE_TITLE} — ${BUSINESS_INFO.brandName}`,
  description: PAGE_DESC,
  alternates: {
    canonical: '/refund-cancellation-policy',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: `${PAGE_TITLE} — ${BUSINESS_INFO.brandName}`,
    description: PAGE_DESC,
    url: `${BUSINESS_INFO.officialWebsiteOrigin}/refund-cancellation-policy`,
    type: 'website',
  },
};

const TOC: LegalTocItem[] = [
  { id: 'digital-nature', label: 'Digital Product Fulfillment & Summary' },
  { id: 'cancellation-policy', label: 'Cancellation Policy' },
  { id: 'refund-eligibility', label: 'Eligible Refund Scenarios' },
  { id: 'non-refundable', label: 'Non-Refundable Scenarios' },
  { id: 'how-to-request', label: 'How to Submit a Refund Request' },
  { id: 'processing-timeline', label: 'Refund Approval & Settlement Timeline' },
  { id: 'chargebacks', label: 'Billing Disputes & Support Escalation' },
];

export default function RefundCancellationPolicyPage() {
  return (
    <LegalDocumentShell
      currentPath="/refund-cancellation-policy"
      title={PAGE_TITLE}
      description={PAGE_DESC}
      toc={TOC}
    >
      {/* Key Timelines Summary Table (Answer-First Compliance Clarity) */}
      <section id="digital-nature" className="scroll-mt-24 space-y-4">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          01. Digital Product Fulfillment &amp; Policy Summary
        </h2>
        <p>
          <strong>{BUSINESS_INFO.brandName}</strong> (operated by{' '}
          <strong>{BUSINESS_INFO.legalName}</strong> at{' '}
          <a
            href={BUSINESS_INFO.officialWebsite}
            className="underline underline-offset-4 font-medium"
          >
            {BUSINESS_INFO.officialWebsite}
          </a>
          ) provides instant-access digital study products—including eBooks,
          question banks, and timed mock exam packs. We provide free syllabus
          breakdowns and sample extracts on product pages so learners can review
          content before paying.
        </p>

        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <table className="w-full text-left border-collapse text-sm tabular-nums">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                <th className="py-3 px-4 font-semibold text-[var(--text-main)]">
                  Policy Parameter
                </th>
                <th className="py-3 px-4 font-semibold text-[var(--text-main)]">
                  Commitment / Timeline
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              <tr>
                <td className="py-3 px-4 text-[var(--text-muted)]">
                  Delivery Mode &amp; Speed
                </td>
                <td className="py-3 px-4 font-medium text-[var(--text-main)]">
                  100% Digital — Instant unlock inside Purchased Library (0 physical shipping)
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 text-[var(--text-muted)]">
                  Pre-Payment Cancellation
                </td>
                <td className="py-3 px-4 font-medium text-[var(--text-main)]">
                  Free at any time before Razorpay payment authorization
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 text-[var(--text-muted)]">
                  Post-Delivery Cancellation
                </td>
                <td className="py-3 px-4 font-medium text-[var(--text-main)]">
                  Not permitted once digital access is unlocked (see eligible refunds below)
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 text-[var(--text-muted)]">
                  Refund Claim Window
                </td>
                <td className="py-3 px-4 font-medium text-[var(--text-main)]">
                  Within {BUSINESS_INFO.refundClaimWindow}
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 text-[var(--text-muted)]">
                  Verification &amp; Approval
                </td>
                <td className="py-3 px-4 font-medium text-[var(--text-main)]">
                  2 to 3 business days from receipt of complete details
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 text-[var(--text-muted)]">
                  Refund Credit Timeline
                </td>
                <td className="py-3 px-4 font-medium text-[var(--text-main)]">
                  {BUSINESS_INFO.refundProcessingWindow} via Razorpay to original payment mode
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="cancellation-policy" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          02. Cancellation Policy
        </h2>
        <ul className="list-disc ps-5 space-y-2">
          <li>
            <strong>Before Payment Completion:</strong> You may remove items
            from your cart or close the Razorpay checkout window at any time
            prior to authorizing payment, with zero cancellation fee.
          </li>
          <li>
            <strong>After Payment &amp; Instant Digital Delivery:</strong> Since
            eBooks, quizbooks, and mock exam packs are intangible digital goods
            provisioned immediately to your Purchased Library upon Razorpay
            verification, completed orders cannot be cancelled once delivered.
          </li>
        </ul>
      </section>

      <section id="refund-eligibility" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          03. Eligible Refund Scenarios
        </h2>
        <p>
          A full refund (100% of the affected charge) will be approved and
          issued if your transaction falls under any of the following verified
          conditions:
        </p>
        <ul className="list-disc ps-5 space-y-2">
          <li>
            <strong>Duplicate / Multiple Charge:</strong> Your bank account,
            UPI, or card was debited more than once for the exact same order or
            product due to a payment gateway timeout or network error. The
            duplicate charge(s) will be refunded in full.
          </li>
          <li>
            <strong>Amount Debited, Digital Access Not Granted:</strong> Your
            payment succeeded at the bank/Razorpay end, yet the purchased book
            or mock exam pack was not unlocked in your Purchased Library within
            24 hours and could not be restored by our support team.
          </li>
          <li>
            <strong>Unresolved Technical Defect:</strong> A purchased digital
            book file or mock test set is corrupted or completely inaccessible
            due to a verified platform error on our end that our engineering
            team is unable to resolve within 3 business days of your report.
          </li>
          <li>
            <strong>Accidental Purchase of Unopened Item (Same Day):</strong> If
            you accidentally purchased the wrong study pack and have{' '}
            <strong>not opened, read, or started any test</strong> inside that
            pack, contact us within 24 hours for a one-time goodwill review.
          </li>
        </ul>
      </section>

      <section id="non-refundable" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          04. Non-Refundable Scenarios
        </h2>
        <p>Refunds cannot be granted in the following cases:</p>
        <ul className="list-disc ps-5 space-y-2">
          <li>
            Digital eBooks, question banks, or mock exam packs that have already
            been opened, viewed, or attempted after delivery.
          </li>
          <li>
            Change of mind, lack of time to study, or purchasing without
            reviewing the free syllabus breakdown and sample extract displayed
            on the product page.
          </li>
          <li>
            Official examination date postponement, syllabus updates by an
            external exam body after purchase, or dissatisfaction with exam
            results.
          </li>
          <li>
            Account termination resulting from violation of our{' '}
            <Link
              href="/terms-of-service"
              className="underline underline-offset-4 font-medium"
            >
              Terms of Service
            </Link>{' '}
            or{' '}
            <Link
              href="/license-agreement"
              className="underline underline-offset-4 font-medium"
            >
              License Agreement
            </Link>{' '}
            (such as piracy or credential sharing).
          </li>
          <li>
            Refund requests submitted more than{' '}
            <strong>{BUSINESS_INFO.refundClaimWindow}</strong> after the
            original purchase date.
          </li>
        </ul>
      </section>

      <section id="how-to-request" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          05. How to Submit a Refund Request
        </h2>
        <p>
          To request a refund or report a failed/duplicate Razorpay transaction,
          email{' '}
          <a
            href={`mailto:${BUSINESS_INFO.supportEmail}`}
            className="underline underline-offset-4 font-semibold"
          >
            {BUSINESS_INFO.supportEmail}
          </a>{' '}
          within <strong>{BUSINESS_INFO.refundClaimWindow}</strong> with the
          subject line{' '}
          <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-[var(--bg-elevated)]">
            Refund Request — [Your Razorpay Payment ID]
          </code>{' '}
          and include:
        </p>
        <ol className="list-decimal ps-5 space-y-1.5 tabular-nums">
          <li>Your registered account email address on {BUSINESS_INFO.brandName}.</li>
          <li>
            The <strong>Razorpay Payment ID</strong> (e.g.{' '}
            <span className="font-mono text-xs">pay_...</span>) or{' '}
            <strong>Order ID</strong> and transaction date/amount.
          </li>
          <li>The title of the purchased eBook or mock exam pack.</li>
          <li>
            A brief description of the issue (plus screenshot of bank/UPI debit
            in case of a duplicate charge or failed unlock).
          </li>
        </ol>
      </section>

      <section id="processing-timeline" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          06. Refund Approval &amp; Settlement Timeline
        </h2>
        <p>
          Our billing support team verifies every claim against Razorpay
          settlement records and platform access logs within{' '}
          <strong>2 to 3 business days</strong> and sends you an email
          confirmation with the decision.
        </p>
        <p>
          Once approved, the refund is initiated immediately via Razorpay back
          to your <strong>original payment method</strong> (UPI, Credit Card,
          Debit Card, Net Banking, or Wallet). We do not issue cash refunds or
          transfers to unrelated third-party accounts. Depending on your issuing
          bank or payment provider&rsquo;s clearing cycle, the refunded amount
          will appear in your account within{' '}
          <strong>{BUSINESS_INFO.refundProcessingWindow}</strong>.
        </p>
      </section>

      <section id="chargebacks" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          07. Billing Disputes &amp; Support Contact
        </h2>
        <p>
          If you notice an unexpected charge or payment discrepancy, please
          contact us first at{' '}
          <a
            href={`mailto:${BUSINESS_INFO.supportEmail}`}
            className="underline underline-offset-4 font-medium"
          >
            {BUSINESS_INFO.supportEmail}
          </a>{' '}
          before initiating a bank chargeback—most payment reconciliation issues
          are resolved within 24–48 business hours. You may also reach our
          registered office at {BUSINESS_INFO.officeAddress} or use our{' '}
          <Link
            href="/contact-us"
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
