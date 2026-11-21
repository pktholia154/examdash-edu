import React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { BUSINESS_INFO, LEGAL_PAGES } from '../../lib/legal/business-info';

export function HomeComplianceSection() {
  return (
    <section
      id="legal-and-compliance"
      aria-labelledby="legal-compliance-heading"
      className="py-12"
    >
      <div className="ed-container">
        <hr className="border-[var(--border-subtle)] mb-10" />

        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h2
              id="legal-compliance-heading"
              className="text-[length:var(--text-h2)] font-extrabold tracking-tight text-[var(--text-main)]"
            >
              Policies, Licensing &amp; Support
            </h2>
            <p className="mt-1.5 text-sm text-[var(--text-muted)] leading-relaxed">
              Transparent digital delivery terms, PCI-DSS compliant Razorpay
              checkout disclosures, refund eligibility timelines, and direct
              merchant contact details for {BUSINESS_INFO.brandName}.
            </p>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Operated by <span className="font-semibold text-[var(--text-main)]">{BUSINESS_INFO.legalName}</span> · Brand:{' '}
            <span className="font-semibold text-[var(--text-main)]">{BUSINESS_INFO.brandName}</span>
          </p>
        </div>

        {/* 5 Required Razorpay Verification Compliance Pages */}
        <nav
          aria-label="Legal and compliance policies"
          className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4"
        >
          {LEGAL_PAGES.map((page, index) => (
            <Link
              key={page.href}
              href={page.href}
              prefetch={false}
              className="group flex flex-col justify-between rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 hover:border-[var(--border-strong)] transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-medium text-[var(--text-muted)] tabular-nums">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <ArrowUpRight
                    className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--text-main)] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 shrink-0"
                    aria-hidden="true"
                  />
                </div>
                <h3 className="mt-3 text-sm font-bold text-[var(--text-main)] group-hover:underline underline-offset-4">
                  {page.title}
                </h3>
                <p className="mt-1.5 text-xs text-[var(--text-muted)] leading-relaxed">
                  {page.summary}
                </p>
              </div>
              <span className="mt-4 text-xs font-semibold text-[var(--text-main)]">
                Read policy
              </span>
            </Link>
          ))}
        </nav>

        {/* Verified Business Identity Strip */}
        <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-[var(--border-subtle)] pt-6 text-xs">
          <div>
            <dt className="text-[var(--text-muted)]">Legal Entity &amp; Brand</dt>
            <dd className="mt-1 font-semibold text-[var(--text-main)]">
              {BUSINESS_INFO.legalName} ({BUSINESS_INFO.brandName})
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Official Website</dt>
            <dd className="mt-1 font-semibold text-[var(--text-main)]">
              <a
                href={BUSINESS_INFO.officialWebsite}
                className="underline underline-offset-4 hover:opacity-80"
              >
                {BUSINESS_INFO.officialWebsite}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Support &amp; Billing Email</dt>
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
            <dt className="text-[var(--text-muted)]">Registered Office Address</dt>
            <dd className="mt-1 font-medium text-[var(--text-main)] leading-relaxed">
              {BUSINESS_INFO.officeAddress}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
