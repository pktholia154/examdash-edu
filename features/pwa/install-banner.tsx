'use client';

import React from 'react';
import Image from 'next/image';
import {
  ArrowUpRight,
  Check,
  Download,
  ExternalLink,
  LayoutGrid,
  Loader2,
  X,
} from 'lucide-react';
import { usePWAInstall } from './pwa-install-provider';

export interface InstallAppCalloutProps {
  variant?: 'home' | 'detail';
  itemKind?: 'book' | 'exam';
  className?: string;
}

/**
 * Adaptive PWA Install / Open-in-App Callout Card
 * Used seamlessly on the Home page canvas and on Book/Exam detail pages right below the Buy Now / Sample bar.
 */
export function InstallAppCallout({
  variant = 'home',
  itemKind,
  className = '',
}: InstallAppCalloutProps) {
  const {
    status,
    progressLabel,
    progressPercent,
    openInAppHref,
    isBannerDismissed,
    triggerPrimaryAction,
    dismissBanner,
  } = usePWAInstall();

  if (status === 'hidden') {
    return null;
  }

  const isTransientOrInstalled =
    status === 'installing' ||
    status === 'installed-success' ||
    status === 'open-in-app';

  if (isBannerDismissed && !isTransientOrInstalled) {
    return null;
  }

  const isDetail = variant === 'detail';
  const showProgressBar =
    status === 'installing' || status === 'installed-success';

  const defaultInstallCta = isDetail ? 'Install Now' : 'Install App';

  let title = isDetail
    ? itemKind === 'exam'
      ? 'Practice This Exam in the ExamDash App'
      : itemKind === 'book'
      ? 'Read This Book in the ExamDash App'
      : 'Install ExamDash App'
    : 'Install ExamDash App';
  let subtitle = isDetail
    ? itemKind === 'exam'
      ? 'Attempt full-length timed mocks offline with instant analytics in a distraction-free app window.'
      : itemKind === 'book'
      ? 'Read offline with dark & sepia comfort themes and instant chapter sync in the standalone app.'
      : 'Launch ebooks, quizbooks, and timed mock exam sets in a distraction-free standalone window.'
    : 'Launch ebooks, quizbooks, and timed mock exam sets in a distraction-free standalone window.';

  if (status === 'installing') {
    title = progressLabel || 'Building app package...';
    subtitle = 'Verifying Home Screen icon and standalone workspace package...';
  } else if (status === 'installed-success') {
    title = 'ExamDash Installed on Your Device';
    subtitle = 'Your Home Screen icon is ready for instant standalone access.';
  } else if (status === 'open-in-app') {
    title = isDetail
      ? itemKind === 'exam'
        ? 'Open This Exam Pack in ExamDash App'
        : itemKind === 'book'
        ? 'Open This Book in ExamDash App'
        : 'ExamDash App is Installed'
      : 'ExamDash App is Installed';
    subtitle =
      'Switch from this browser tab into your standalone ExamDash app window.';
  } else if (status === 'apple-ios') {
    title = isDetail
      ? 'Install ExamDash on Home Screen'
      : 'Install ExamDash on Home Screen';
    subtitle = isDetail
      ? itemKind === 'exam'
        ? 'Add to Home Screen for full-screen timed mock tests on iPhone or iPad.'
        : 'Add to Home Screen for full-screen offline reading on iPhone or iPad.'
      : 'Open ebooks and mock exam sets full-screen like a native iPhone or iPad app.';
  } else if (status === 'apple-mac-safari') {
    title = 'Add ExamDash to your Mac Dock';
    subtitle =
      'Launch distraction-free study and mock exam windows directly from macOS.';
  } else if (status === 'in-app-webview') {
    title = 'Open in Browser to Install ExamDash';
    subtitle =
      'In-app browsers block Home Screen installs. Open in Chrome or Safari to install.';
  }

  return (
    <div
      data-nosnippet=""
      className={`relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 max-md:px-3.5 ${
        isDetail ? 'py-3' : 'py-3.5 max-md:py-3'
      } transition-colors ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 max-md:gap-2.5">
        <div className="flex items-center gap-3 min-w-0">
          <Image
            src="/assets/aistudio/exam-dash_logo_ef0c6c39.png"
            alt="ExamDash app icon"
            width={isDetail ? 36 : 40}
            height={isDetail ? 36 : 40}
            referrerPolicy="no-referrer"
            className={`${
              isDetail ? 'w-9 h-9 rounded-lg' : 'w-10 h-10 rounded-xl'
            } object-cover shrink-0`}
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-main)]">
              {title}
            </p>
            <p className="text-xs text-[var(--text-muted)]">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 max-md:w-full max-md:justify-between">
          {status === 'installing' && (
            <button
              type="button"
              disabled
              aria-live="polite"
              className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-xs font-semibold text-[var(--text-main)] whitespace-nowrap shrink-0 cursor-wait max-md:flex-1 max-md:justify-center min-w-0"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
              <span className="truncate">{progressLabel || 'Building app package...'}</span>
            </button>
          )}

          {status === 'installed-success' && (
            <div
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-[var(--status-success)] text-white text-xs font-semibold whitespace-nowrap shrink-0 max-md:flex-1 max-md:justify-center min-w-0"
            >
              <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Successfully Installed</span>
            </div>
          )}

          {status === 'open-in-app' && (
            <a
              id="link-open-app"
              href={openInAppHref}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 max-md:flex-1 max-md:justify-center min-w-0"
            >
              <span>Open in App</span>
              <ArrowUpRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            </a>
          )}

          {(status === 'ready-to-install' ||
            status === 'apple-ios' ||
            status === 'iframe-preview') && (
            <button
              id="btn-install"
              type="button"
              onClick={() => void triggerPrimaryAction()}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 max-md:flex-1 max-md:justify-center min-w-0"
            >
              <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{defaultInstallCta}</span>
            </button>
          )}

          {status === 'apple-mac-safari' && (
            <button
              id="btn-install"
              type="button"
              onClick={() => void triggerPrimaryAction()}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 max-md:flex-1 max-md:justify-center min-w-0"
            >
              <LayoutGrid className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Add to Dock</span>
            </button>
          )}

          {status === 'in-app-webview' && (
            <button
              type="button"
              onClick={() => void triggerPrimaryAction()}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 max-md:flex-1 max-md:justify-center min-w-0"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Open in Browser to Install</span>
            </button>
          )}

          {!isTransientOrInstalled && (
            <button
              type="button"
              aria-label="Dismiss install banner"
              onClick={dismissBanner}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Stepped WebAPK / OS Icon Verification Progress Bar (GPU-composited scaleX) */}
      {showProgressBar && (
        <div
          id="progress-wrap"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPercent}
          aria-label={progressLabel || 'App installation progress'}
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]"
        >
          <div
            className={`h-full w-full origin-left rounded-full transition-transform duration-700 ease-out ${
              status === 'installed-success'
                ? 'bg-[var(--status-success)]'
                : 'bg-[var(--brand-primary)]'
            } ${
              progressPercent >= 100
                ? 'scale-x-100'
                : progressPercent >= 80
                ? 'scale-x-[0.8]'
                : progressPercent >= 45
                ? 'scale-x-[0.45]'
                : 'scale-x-0'
            }`}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Compact Desktop/Tablet Navbar Action (rendered inside AppShell Zone 3 on lg+ viewports)
 * Gives 1-click Install / Add to Dock / Open in App access on any catalog or detail page.
 */
export function HeaderPwaAction() {
  const {
    status,
    progressLabel,
    openInAppHref,
    triggerPrimaryAction,
  } = usePWAInstall();

  if (status === 'hidden') {
    return null;
  }

  if (status === 'installing') {
    return (
      <div
        data-nosnippet=""
        aria-live="polite"
        className="hidden lg:inline-flex items-center gap-2 min-h-[48px] px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-xs font-semibold text-[var(--text-main)] whitespace-nowrap shrink-0"
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
        <span>{progressLabel || 'Installing...'}</span>
      </div>
    );
  }

  if (status === 'installed-success') {
    return (
      <div
        data-nosnippet=""
        role="status"
        aria-live="polite"
        className="hidden lg:inline-flex items-center gap-1.5 min-h-[48px] px-3 rounded-lg bg-[var(--status-success)] text-white text-xs font-semibold whitespace-nowrap shrink-0"
      >
        <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Installed</span>
      </div>
    );
  }

  if (status === 'open-in-app') {
    return (
      <a
        data-nosnippet=""
        href={openInAppHref}
        target="_blank"
        rel="noopener"
        className="hidden lg:inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--brand-primary)] transition-colors whitespace-nowrap shrink-0"
      >
        <span>Open in App</span>
        <ArrowUpRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      </a>
    );
  }

  const label =
    status === 'apple-mac-safari'
      ? 'Add to Dock'
      : status === 'in-app-webview'
      ? 'Open in Browser'
      : 'Install App';

  return (
    <button
      data-nosnippet=""
      type="button"
      onClick={() => void triggerPrimaryAction()}
      className="hidden lg:inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap shrink-0"
    >
      {status === 'apple-mac-safari' ? (
        <LayoutGrid className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      ) : status === 'in-app-webview' ? (
        <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      )}
      <span>{label}</span>
    </button>
  );
}

/**
 * Slim Mobile Handoff Banner for Non-Home Routes (/books/*, /exams/*)
 * Appears on mobile viewports ONLY when ExamDash is already installed on the OS (or mid-install)
 * so deep links opened in Chrome can jump directly into the standalone WebAPK in 1 tap.
 */
export function MobileOpenInAppBanner() {
  const { status, progressLabel, openInAppHref } = usePWAInstall();

  if (
    status !== 'open-in-app' &&
    status !== 'installing' &&
    status !== 'installed-success'
  ) {
    return null;
  }

  return (
    <div
      data-nosnippet=""
      className="lg:hidden border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]"
    >
      <div className="ed-container py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Image
            src="/assets/aistudio/exam-dash_logo_ef0c6c39.png"
            alt="ExamDash"
            width={28}
            height={28}
            referrerPolicy="no-referrer"
            className="w-7 h-7 rounded-lg object-cover shrink-0"
          />
          <span className="text-xs font-medium text-[var(--text-main)] truncate">
            {status === 'installing'
              ? progressLabel || 'Building app package...'
              : status === 'installed-success'
              ? 'Successfully Installed ✓'
              : 'Open this page in ExamDash App'}
          </span>
        </div>

        {status === 'open-in-app' && (
          <a
            href={openInAppHref}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 min-h-[36px] max-md:min-h-[44px] px-3 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <span>Open in App</span>
            <ArrowUpRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}
