'use client';

import React from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  ArrowUpRight,
  Check,
  Download,
  ExternalLink,
  LayoutGrid,
  Loader2,
} from 'lucide-react';
import { isOpenInAppAllowedRoute } from '../../lib/pwa/detection';
import { usePWAInstall } from './pwa-install-provider';

export interface InstallAppCalloutProps {
  variant?: 'home' | 'detail';
  itemKind?: 'book' | 'exam';
  className?: string;
}

/**
 * Minimal Adaptive PWA Install Banner
 * Renders identically on the Home page and on Book/Exam detail pages.
 */
export function InstallAppCallout({
  variant = 'home',
  className = '',
}: InstallAppCalloutProps) {
  const {
    status,
    progressLabel,
    progressPercent,
    openInAppHref,
    triggerPrimaryAction,
  } = usePWAInstall();

  if (status === 'hidden') {
    return null;
  }

  const showProgressBar =
    status === 'installing' || status === 'installed-success';

  const surfaceBgClass =
    variant === 'detail' || variant === 'home'
      ? 'bg-[#e6e6e6]'
      : 'bg-[var(--bg-surface)]';

  return (
    <div
      data-nosnippet=""
      className={`relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)] ${surfaceBgClass} px-3.5 py-2.5 transition-colors ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Image
            src="/assets/aistudio/exam-dash_logo_ef0c6c39.png"
            alt="ExamDash app icon"
            width={32}
            height={32}
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-lg object-cover shrink-0"
          />
          <p className="text-sm font-semibold text-[var(--text-main)] truncate">
            ExamDash App
          </p>
        </div>

        <div className="flex items-center shrink-0">
          {status === 'installing' && (
            <button
              type="button"
              disabled
              aria-live="polite"
              className="inline-flex items-center gap-1.5 min-h-[40px] max-md:min-h-[44px] px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-xs font-semibold text-[var(--text-main)] whitespace-nowrap shrink-0 cursor-wait"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
              <span>{progressLabel || 'Installing...'}</span>
            </button>
          )}

          {status === 'installed-success' && (
            <div
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-1.5 min-h-[40px] max-md:min-h-[44px] px-3.5 rounded-lg bg-[var(--status-success)] text-white text-xs font-semibold whitespace-nowrap shrink-0"
            >
              <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Installed</span>
            </div>
          )}

          {status === 'open-in-app' && (
            <a
              id="link-open-app"
              href={openInAppHref}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 min-h-[40px] max-md:min-h-[44px] px-3.5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
            >
              <span>Open in App</span>
              <ArrowUpRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            </a>
          )}

          {(status === 'ready-to-install' ||
            status === 'apple-ios' ||
            status === 'iframe-preview' ||
            status === 'apple-mac-safari' ||
            status === 'in-app-webview') && (
            <button
              id="btn-install"
              type="button"
              onClick={() => void triggerPrimaryAction()}
              className="inline-flex items-center gap-1.5 min-h-[40px] max-md:min-h-[44px] px-3.5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Install App</span>
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
          className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]"
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
 * Gives 1-click Install / Add to Dock access; post-install "Open in App" is shown only on Home and Product Detail routes.
 */
export function HeaderPwaAction() {
  const pathname = usePathname() || '/';
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
    if (!isOpenInAppAllowedRoute(pathname)) {
      return null;
    }
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

