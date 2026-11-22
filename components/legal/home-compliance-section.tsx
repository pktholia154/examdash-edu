import React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { BUSINESS_INFO, LEGAL_PAGES } from '../../lib/legal/business-info';

export function HomeComplianceSection() {
  return (
    <section
      id="legal-and-compliance"
      aria-labelledby="legal-compliance-heading"
      className="py-12 max-md:py-6"
    >
      <div className="ed-container">
        <hr className="border-[var(--border-subtle)] mb-10 max-md:mb-6" />

        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h2
              id="legal-compliance-heading"
              className="text-[length:var(--text-h2)] font-extrabold tracking-tight text-[var(--text-main)]"
            >
              Policies, Licensing &amp; Support
            </h2>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Operated by <span className="font-semibold text-[var(--text-main)]">{BUSINESS_INFO.legalName}</span> · Brand:{' '}
            <span className="font-semibold text-[var(--text-main)]">{BUSINESS_INFO.brandName}</span>
          </p>
        </div>

        {/* 5 Required Razorpay Verification Compliance Pages */}
        <nav
          aria-label="Legal and compliance policies"
          className="mt-5 max-md:mt-3.5 flex flex-wrap items-center gap-2.5 max-md:gap-2"
        >
          {LEGAL_PAGES.map((page) => (
            <Link
              key={page.href}
              href={page.href}
              prefetch={false}
              className="group inline-flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
            >
              <span>{page.title}</span>
              <ArrowUpRight
                className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--text-main)] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 shrink-0"
                aria-hidden="true"
              />
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
                className="underline underline-offset-4 hover:opacity-80 break-all"
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
                className="underline underline-offset-4 hover:opacity-80 break-all"
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
