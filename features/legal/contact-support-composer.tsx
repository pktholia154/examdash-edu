'use client';

import React, { useState } from 'react';
import { Check, Copy, Mail, Send } from 'lucide-react';
import { BUSINESS_INFO } from '../../lib/legal/business-info';
import { useToast } from '../toast/toast-context';

const INQUIRY_CATEGORIES = [
  'Payment / Razorpay Transaction Issue',
  'Refund or Duplicate Charge Request',
  'Digital Book or Mock Exam Access',
  'Account Deletion / Privacy Request',
  'License & Institutional Inquiry',
  'General Support',
] as const;

export function ContactSupportComposer() {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [category, setCategory] = useState<string>(INQUIRY_CATEGORIES[0]);
  const [message, setMessage] = useState('');
  const [copiedKey, setCopiedKey] = useState<'email' | 'address' | 'draft' | null>(
    null
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const copyText = async (
    value: string,
    key: 'email' | 'address' | 'draft',
    successMessage: string
  ) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      showToast(successMessage, 'success');
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2200);
    } catch {
      showToast(
        'Clipboard access unavailable. Please select and copy manually.',
        'danger'
      );
    }
  };

  const buildEmailContent = () => {
    const subject = `[Exam Kart Support] ${category}${
      orderRef.trim() ? ` — Ref: ${orderRef.trim()}` : ''
    }`;
    const bodyLines = [
      `Hello Exam Kart Support Team (${BUSINESS_INFO.legalName}),`,
      '',
      `Category: ${category}`,
      `Name: ${name.trim() || 'Not provided'}`,
      `Registered Email: ${email.trim() || 'Not provided'}`,
      `Razorpay Payment / Order ID: ${orderRef.trim() || 'Not applicable'}`,
      '',
      'Message:',
      message.trim(),
      '',
      `Sent via ${BUSINESS_INFO.officialWebsite}contact-us`,
    ];
    return {
      subject,
      body: bodyLines.join('\n'),
    };
  };

  const handleOpenEmailClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) {
      setValidationError(
        'Please enter your name, registered email address, and inquiry message.'
      );
      return;
    }
    setValidationError(null);
    const { subject, body } = buildEmailContent();
    const mailtoHref = `mailto:${BUSINESS_INFO.supportEmail}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoHref;
    showToast(
      `Opening your email app addressed to ${BUSINESS_INFO.supportEmail}.`,
      'neutral'
    );
  };

  const handleCopyDraft = () => {
    if (!message.trim()) {
      setValidationError(
        'Enter your message first so we can format and copy your support email draft.'
      );
      return;
    }
    setValidationError(null);
    const { subject, body } = buildEmailContent();
    const formatted = `To: ${BUSINESS_INFO.supportEmail}\nSubject: ${subject}\n\n${body}`;
    void copyText(
      formatted,
      'draft',
      'Support email draft copied. Paste it into your email client.'
    );
  };

  return (
    <div className="space-y-6">
      {/* Direct Quick-Copy Utility Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-muted)]">Official Support Email</p>
            <a
              href={`mailto:${BUSINESS_INFO.supportEmail}`}
              className="mt-0.5 block text-sm font-semibold text-[var(--text-main)] underline underline-offset-4 truncate"
            >
              {BUSINESS_INFO.supportEmail}
            </a>
          </div>
          <button
            type="button"
            onClick={() =>
              void copyText(
                BUSINESS_INFO.supportEmail,
                'email',
                'Support email copied to clipboard.'
              )
            }
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap shrink-0"
          >
            {copiedKey === 'email' ? (
              <>
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-muted)]">Registered Office Address</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--text-main)] truncate">
              SCO-28, Sector 13, Bhiwani, Haryana
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              void copyText(
                BUSINESS_INFO.officeAddress,
                'address',
                'Full office address copied to clipboard.'
              )
            }
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap shrink-0"
          >
            {copiedKey === 'address' ? (
              <>
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Structured Support Email Composer */}
      <form
        onSubmit={handleOpenEmailClient}
        noValidate
        className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 space-y-5"
      >
        <div>
          <h3 className="text-base font-bold text-[var(--text-main)]">
            Compose a Support or Billing Inquiry
          </h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Fill in the details below to launch a pre-formatted email to{' '}
            <span className="font-semibold text-[var(--text-main)]">
              {BUSINESS_INFO.supportEmail}
            </span>{' '}
            or copy the structured message directly for Gmail/webmail.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="contact-name"
              className="block text-xs font-semibold text-[var(--text-main)] mb-1.5"
            >
              Full Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="contact-name"
              name="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              className="w-full min-h-[48px] px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-base sm:text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:border-[var(--brand-primary)] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="contact-email"
              className="block text-xs font-semibold text-[var(--text-main)] mb-1.5"
            >
              Registered Account Email <span aria-hidden="true">*</span>
            </label>
            <input
              id="contact-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full min-h-[48px] px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-base sm:text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:border-[var(--brand-primary)] focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="contact-category"
              className="block text-xs font-semibold text-[var(--text-main)] mb-1.5"
            >
              Inquiry Category
            </label>
            <select
              id="contact-category"
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full min-h-[48px] px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-base sm:text-sm text-[var(--text-main)] focus:border-[var(--brand-primary)] focus:outline-none"
            >
              {INQUIRY_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="contact-order-ref"
              className="block text-xs font-semibold text-[var(--text-main)] mb-1.5"
            >
              Razorpay Payment / Order ID (Optional)
            </label>
            <input
              id="contact-order-ref"
              name="orderRef"
              type="text"
              value={orderRef}
              onChange={(e) => setOrderRef(e.target.value)}
              placeholder="e.g. pay_Q1234567890 or order_..."
              className="w-full min-h-[48px] px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-base sm:text-sm font-mono text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:border-[var(--brand-primary)] focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="contact-message"
            className="block text-xs font-semibold text-[var(--text-main)] mb-1.5"
          >
            Message Details <span aria-hidden="true">*</span>
          </label>
          <textarea
            id="contact-message"
            name="message"
            rows={4}
            required
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe your question, book or exam pack title, or payment transaction date..."
            className="w-full p-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-base sm:text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:border-[var(--brand-primary)] focus:outline-none resize-y"
          />
        </div>

        {validationError && (
          <p
            role="alert"
            className="text-xs font-medium text-[var(--status-danger)]"
          >
            {validationError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            <Send className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Open in Email App</span>
          </button>

          <button
            type="button"
            onClick={handleCopyDraft}
            className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-sm font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap"
          >
            {copiedKey === 'draft' ? (
              <>
                <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Copied Draft</span>
              </>
            ) : (
              <>
                <Mail className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Copy Formatted Message</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
