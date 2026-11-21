import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import {
  LegalDocumentShell,
  type LegalTocItem,
} from '../../components/legal/legal-document-shell';
import { BUSINESS_INFO } from '../../lib/legal/business-info';

const PAGE_TITLE = 'Terms of Service';
const PAGE_DESC =
  'Terms and conditions governing access to Exam Kart (Pardeep Kumar) digital eBooks, question banks, mock exam test series, and Razorpay payments on https://exam-dash.com/.';

export const metadata: Metadata = {
  title: `${PAGE_TITLE} — ${BUSINESS_INFO.brandName}`,
  description: PAGE_DESC,
  alternates: {
    canonical: '/terms-of-service',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: `${PAGE_TITLE} — ${BUSINESS_INFO.brandName}`,
    description: PAGE_DESC,
    url: `${BUSINESS_INFO.officialWebsiteOrigin}/terms-of-service`,
    type: 'website',
  },
};

const TOC: LegalTocItem[] = [
  { id: 'acceptance', label: 'Acceptance of Terms & Entity' },
  { id: 'products-delivery', label: 'Digital Products & Instant Delivery' },
  { id: 'accounts-eligibility', label: 'User Accounts & Eligibility' },
  { id: 'pricing-payments', label: 'Pricing, Taxes & Razorpay Payments' },
  { id: 'refunds-cancellations', label: 'Cancellations & Refunds' },
  { id: 'acceptable-use', label: 'Acceptable Use & Prohibited Conduct' },
  { id: 'intellectual-property', label: 'Intellectual Property & Licensing' },
  { id: 'disclaimers-liability', label: 'Disclaimers & Limitation of Liability' },
  { id: 'governing-law', label: 'Governing Law & Dispute Resolution' },
];

export default function TermsOfServicePage() {
  return (
    <LegalDocumentShell
      currentPath="/terms-of-service"
      title={PAGE_TITLE}
      description={PAGE_DESC}
      toc={TOC}
    >
      <section id="acceptance" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          01. Acceptance of Terms &amp; Merchant Entity
        </h2>
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) constitute a legally
          binding agreement between you (&ldquo;User&rdquo;, &ldquo;Learner&rdquo;)
          and <strong>{BUSINESS_INFO.legalName}</strong>, proprietor and
          operator of the brand <strong>{BUSINESS_INFO.brandName}</strong>,
          accessible via{' '}
          <a
            href={BUSINESS_INFO.officialWebsite}
            className="underline underline-offset-4 font-medium"
          >
            {BUSINESS_INFO.officialWebsite}
          </a>{' '}
          with registered office at {BUSINESS_INFO.officeAddress}.
        </p>
        <p>
          By browsing our catalog, signing in, adding items to your cart, or
          completing a purchase, you confirm that you have read, understood, and
          agreed to be bound by these Terms along with our{' '}
          <Link
            href="/privacy-policy"
            className="underline underline-offset-4 font-medium"
          >
            Privacy Policy
          </Link>
          ,{' '}
          <Link
            href="/refund-cancellation-policy"
            className="underline underline-offset-4 font-medium"
          >
            Refund &amp; Cancellation Policy
          </Link>
          , and{' '}
          <Link
            href="/license-agreement"
            className="underline underline-offset-4 font-medium"
          >
            License Agreement
          </Link>
          .
        </p>
      </section>

      <section id="products-delivery" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          02. Digital Products &amp; Instant Electronic Delivery
        </h2>
        <p>
          {BUSINESS_INFO.brandName} exclusively sells and delivers{' '}
          <strong>digital educational products</strong>, including structured
          eBooks, chapter-wise question banks, quizbooks, and full-length timed
          computer-based mock exam test series.
        </p>
        <ul className="list-disc ps-5 space-y-2">
          <li>
            <strong>No Physical Shipping:</strong> All catalog offerings are
            100% digital. No physical books, CDs, or printed parcels are shipped
            to your postal address.
          </li>
          <li>
            <strong>Instant Fulfillment Timeline:</strong> Upon successful
            payment verification by Razorpay, purchased items are unlocked
            automatically and instantaneously inside your signed-in{' '}
            <strong>Purchased Library</strong> (typically within seconds). In
            rare cases of banking network latency, digital activation is
            completed within 24 hours upon verification by our support desk at{' '}
            <a
              href={`mailto:${BUSINESS_INFO.supportEmail}`}
              className="underline underline-offset-4 font-medium"
            >
              {BUSINESS_INFO.supportEmail}
            </a>
            .
          </li>
          <li>
            <strong>Free Previews Before Purchase:</strong> Detailed syllabi,
            paper structures, and sample book extracts are published on catalog
            pages so you can verify suitability prior to ordering.
          </li>
        </ul>
      </section>

      <section id="accounts-eligibility" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          03. User Accounts &amp; Eligibility
        </h2>
        <p>
          You must be at least 18 years of age, or accessing the Platform under
          the supervision and consent of a parent or legal guardian, to create
          an account and make payments. Each account is licensed for a single
          individual learner. You are responsible for maintaining the
          confidentiality of your sign-in credentials and for all activities
          conducted under your account. Sharing login credentials across
          multiple individuals or commercial groups is strictly prohibited and
          may result in immediate account suspension without refund.
        </p>
      </section>

      <section id="pricing-payments" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          04. Pricing, Taxes &amp; Razorpay Payment Terms
        </h2>
        <ul className="list-disc ps-5 space-y-2">
          <li>
            <strong>Transparent Pricing:</strong> All product prices are clearly
            displayed on product detail pages and in the shopping cart in Indian
            Rupees (INR / ₹) or the stated listing currency prior to checkout.
            Prices may be updated for future purchases without prior notice, but
            changes never affect already completed orders.
          </li>
          <li>
            <strong>Authorized Payment Gateway:</strong> Payments are securely
            collected through <strong>Razorpay</strong> via UPI, Credit/Debit
            Cards, Net Banking, and supported wallets. Orders are confirmed only
            after cryptographic server-side signature verification of the
            Razorpay transaction.
          </li>
          <li>
            <strong>Free Study Packs:</strong> Items priced at ₹0 may be claimed
            directly into your Purchased Library without a monetary charge once
            signed in.
          </li>
        </ul>
      </section>

      <section id="refunds-cancellations" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          05. Cancellations &amp; Refunds
        </h2>
        <p>
          Because digital study materials are delivered instantaneously upon
          payment confirmation, completed orders cannot be cancelled once
          unlocked. Eligible refunds (such as duplicate payments, debited
          payments with failed delivery, or verified unresolved technical
          defects) are processed strictly in accordance with our{' '}
          <Link
            href="/refund-cancellation-policy"
            className="underline underline-offset-4 font-medium"
          >
            Refund &amp; Cancellation Policy
          </Link>
          . Approved refunds are credited back to the original Razorpay payment
          source within <strong>{BUSINESS_INFO.refundProcessingWindow}</strong>.
        </p>
      </section>

      <section id="acceptable-use" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          06. Acceptable Use &amp; Prohibited Conduct
        </h2>
        <p>When using {BUSINESS_INFO.brandName}, you agree NOT to:</p>
        <ul className="list-disc ps-5 space-y-2">
          <li>
            Copy, reproduce, screen-record, scrape, print-to-PDF, or
            redistribute paid eBooks, question banks, or mock exam explanations
            on Telegram, WhatsApp, file-sharing sites, or coaching portals.
          </li>
          <li>
            Bypass or tamper with payment verification endpoints, signed media
            URLs, access controls, or CBT exam timers.
          </li>
          <li>
            Use automated bots, crawlers, or scrapers to harvest proprietary
            question banks or train third-party machine learning models.
          </li>
          <li>
            Submit fraudulent chargebacks after receiving verified digital
            access to purchased materials.
          </li>
        </ul>
      </section>

      <section id="intellectual-property" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          07. Intellectual Property &amp; Licensing
        </h2>
        <p>
          All content published on {BUSINESS_INFO.officialWebsite}—including
          eBook texts, curated MCQ banks, detailed explanations, syllabus
          structures, software code, and branding—is the intellectual property
          of <strong>{BUSINESS_INFO.legalName} ({BUSINESS_INFO.brandName})</strong>{' '}
          or its content licensors, protected under the Indian Copyright Act,
          1957 and applicable trademark laws. Purchasing an item grants you a
          personal, non-transferable usage license as detailed in our{' '}
          <Link
            href="/license-agreement"
            className="underline underline-offset-4 font-medium"
          >
            License Agreement
          </Link>
          ; it does not transfer copyright ownership.
        </p>
      </section>

      <section id="disclaimers-liability" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          08. Educational Disclaimer &amp; Limitation of Liability
        </h2>
        <p>
          Our study materials and mock exams are prepared with care as
          independent exam preparation aids. {BUSINESS_INFO.brandName} is not
          affiliated with any government examination authority unless explicitly
          stated, and does not guarantee specific examination scores, ranks, or
          admissions.
        </p>
        <p>
          To the maximum extent permitted by Indian law, the total aggregate
          liability of {BUSINESS_INFO.legalName} ({BUSINESS_INFO.brandName}) for
          any claim arising out of or relating to the Platform or any purchased
          digital item shall not exceed the actual amount paid by you for the
          specific item giving rise to the claim during the preceding twelve
          (12) months.
        </p>
      </section>

      <section id="governing-law" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-[var(--text-main)] pb-2 border-b border-[var(--border-subtle)]">
          09. Governing Law, Jurisdiction &amp; Updates
        </h2>
        <p>
          These Terms are governed by and construed in accordance with the laws
          of India. Any dispute, controversy, or claim arising out of these
          Terms or any payment transaction shall be subject to the exclusive
          jurisdiction of the competent courts located in{' '}
          <strong>{BUSINESS_INFO.jurisdiction}</strong>.
        </p>
        <p>
          We may update these Terms periodically to reflect legal, regulatory,
          or product updates. The revised &ldquo;Last updated&rdquo; date at the
          top of this page indicates the latest effective version. For questions
          regarding these Terms, please contact{' '}
          <a
            href={`mailto:${BUSINESS_INFO.supportEmail}`}
            className="underline underline-offset-4 font-medium"
          >
            {BUSINESS_INFO.supportEmail}
          </a>{' '}
          or visit our{' '}
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
