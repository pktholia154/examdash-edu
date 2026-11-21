import React from 'react';
import Link from 'next/link';
import { Breadcrumbs } from '../ui/breadcrumbs';
import { BUSINESS_INFO, LEGAL_PAGES } from '../../lib/legal/business-info';
import {
  buildLegalPageJsonLd,
  serializeSafeJsonLd,
} from '../../lib/seo/schema';

export interface LegalTocItem {
  id: string;
  label: string;
}

export interface LegalDocumentShellProps {
  currentPath: string;
  title: string;
  description: string;
  categoryLabel?: string;
  pageType?: 'WebPage' | 'ContactPage';
  toc: LegalTocItem[];
  children: React.ReactNode;
}

export function LegalDocumentShell({
  currentPath,
  title,
  description,
  categoryLabel = 'Legal & Payment Compliance',
  pageType = 'WebPage',
  toc,
  children,
}: LegalDocumentShellProps) {
  const jsonLd = serializeSafeJsonLd(
    buildLegalPageJsonLd({
      title,
      description,
      path: currentPath,
      pageType,
    })
  );

  return (
    <div className="pt-8 pb-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />

      <div className="ed-container">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: title }]} />

        {/* Editorial Document Header */}
        <header className="pb-8 border-b border-[var(--border-subtle)] max-w-4xl">
          <p className="text-xs font-medium text-[var(--text-muted)] flex flex-wrap items-center gap-2">
            <span>{BUSINESS_INFO.brandName}</span>
            <span aria-hidden="true">·</span>
            <span>{categoryLabel}</span>
            <span aria-hidden="true">·</span>
            <span>Last updated {BUSINESS_INFO.effectiveDate}</span>
          </p>

          <h1
            className="mt-3 text-[length:var(--text-h1)] font-extrabold tracking-tight text-[var(--text-main)] leading-tight"
            style={{ textWrap: 'balance' }}
          >
            {title}
          </h1>

          <p className="mt-3 text-base text-[var(--text-muted)] leading-relaxed max-w-3xl">
            {description}
          </p>
        </header>

        {/* Two-Column Asymmetric Reading Layout */}
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-10 lg:gap-12 items-start">
          {/* Primary Reading Column (65–72ch optimal measure) */}
          <article className="min-w-0 max-w-3xl space-y-10 text-[15px] leading-[1.75] text-[var(--text-main)]">
            {children}
          </article>

          {/* Right Margin Rail: TOC + Verified Merchant Details + Policy Index */}
          <aside
            aria-label="Document navigation and verified merchant details"
            className="lg:sticky lg:top-24 space-y-8"
          >
            {toc.length > 0 && (
              <nav
                aria-label="On this page"
                className="border-t border-[var(--border-subtle)] pt-5"
              >
                <h2 className="text-xs font-bold tracking-wider uppercase text-[var(--text-muted)]">
                  On this page
                </h2>
                <ol className="mt-3 space-y-2 text-sm">
                  {toc.map((item, idx) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        className="inline-flex items-baseline gap-2 text-[var(--text-muted)] hover:text-[var(--text-main)] hover:underline underline-offset-4 transition-colors"
                      >
                        <span className="font-mono text-xs tabular-nums shrink-0">
                          {String(idx + 1).padStart(2, '0')}.
                        </span>
                        <span>{item.label}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}

            {/* Verified Business Entity Block (Razorpay KYC Parity) */}
            <section
              aria-label="Verified merchant details"
              className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
            >
              <h2 className="text-xs font-bold tracking-wider uppercase text-[var(--text-muted)]">
                Merchant & Entity Details
              </h2>
              <dl className="mt-3 divide-y divide-[var(--border-subtle)] text-xs">
                <div className="py-2.5">
                  <dt className="text-[var(--text-muted)]">Legal Name</dt>
                  <dd className="mt-0.5 font-semibold text-[var(--text-main)]">
                    {BUSINESS_INFO.legalName}
                  </dd>
                </div>
                <div className="py-2.5">
                  <dt className="text-[var(--text-muted)]">Brand Name</dt>
                  <dd className="mt-0.5 font-semibold text-[var(--text-main)]">
                    {BUSINESS_INFO.brandName}
                  </dd>
                </div>
                <div className="py-2.5">
                  <dt className="text-[var(--text-muted)]">Official Website</dt>
                  <dd className="mt-0.5 font-medium text-[var(--text-main)] break-all">
                    <a
                      href={BUSINESS_INFO.officialWebsite}
                      className="underline underline-offset-4 hover:opacity-80"
                    >
                      {BUSINESS_INFO.officialWebsite}
                    </a>
                  </dd>
                </div>
                <div className="py-2.5">
                  <dt className="text-[var(--text-muted)]">Support Email</dt>
                  <dd className="mt-0.5 font-medium text-[var(--text-main)] break-all">
                    <a
                      href={`mailto:${BUSINESS_INFO.supportEmail}`}
                      className="underline underline-offset-4 hover:opacity-80"
                    >
                      {BUSINESS_INFO.supportEmail}
                    </a>
                  </dd>
                </div>
                <div className="pt-2.5">
                  <dt className="text-[var(--text-muted)]">Office Address</dt>
                  <dd className="mt-0.5 font-medium text-[var(--text-main)] leading-relaxed">
                    {BUSINESS_INFO.officeAddress}
                  </dd>
                </div>
              </dl>
            </section>

            {/* Cross-Links to All 5 Compliance Pages */}
            <nav
              aria-label="Policy and compliance pages"
              className="border-t border-[var(--border-subtle)] pt-5"
            >
              <h2 className="text-xs font-bold tracking-wider uppercase text-[var(--text-muted)]">
                Policies & Support
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                {LEGAL_PAGES.map((page) => {
                  const isCurrent = currentPath === page.href;
                  return (
                    <li key={page.href}>
                      <Link
                        href={page.href}
                        prefetch={false}
                        aria-current={isCurrent ? 'page' : undefined}
                        className={
                          isCurrent
                            ? 'block font-semibold text-[var(--text-main)] underline underline-offset-4'
                            : 'block text-[var(--text-muted)] hover:text-[var(--text-main)] hover:underline underline-offset-4 transition-colors'
                        }
                      >
                        {page.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </aside>
        </div>
      </div>
    </div>
  );
}
