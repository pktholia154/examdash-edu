'use client';

import React from 'react';
import Image from 'next/image';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  LayoutGrid,
  MoreHorizontal,
  PlusSquare,
  Share,
  X,
} from 'lucide-react';

export type GuidedSheetKind =
  | 'apple-ios'
  | 'apple-mac-safari'
  | 'in-app-webview'
  | 'iframe-preview';

export interface PWAGuidedSheetsProps {
  sheet: GuidedSheetKind;
  copiedLink: boolean;
  fullTabInstallHref: string;
  onClose: () => void;
  onDismissAppleForever: () => void;
  onCopyLink: () => void;
}

export function PWAGuidedSheets({
  sheet,
  copiedLink,
  fullTabInstallHref,
  onClose,
  onDismissAppleForever,
  onCopyLink,
}: PWAGuidedSheetsProps) {
  return (
    <>
      {/* Apple iOS / iPadOS Compact Guided Bottom Sheet (#apple-sheet) */}
      {sheet === 'apple-ios' && (
        <div
          id="apple-sheet"
          data-nosnippet=""
          role="dialog"
          aria-modal="true"
          aria-label="Install ExamDash on Home Screen"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <button
            type="button"
            aria-label="Close install instructions"
            onClick={onClose}
            className="fixed inset-0 h-[100lvh] bg-black/50"
          />
          <div className="relative z-10 w-full sm:max-w-md rounded-t-2xl sm:rounded-[var(--radius-card)] border-t sm:border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 pb-[calc(1.25rem+var(--safe-area-inset-bottom))] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Image
                  src="/assets/aistudio/exam-dash_logo_ef0c6c39.png"
                  alt="ExamDash"
                  width={40}
                  height={40}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-xl object-cover shrink-0"
                />
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-[var(--text-main)] truncate">
                    Install ExamDash on Home Screen
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Standalone full-screen reader &amp; mock exam workspace
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close sheet"
                onClick={onClose}
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <ol className="mt-4 space-y-3 text-sm text-[var(--text-muted)]">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] shrink-0">
                  1
                </span>
                <span>
                  Tap{' '}
                  <strong className="inline-flex items-center gap-1 text-[var(--text-main)]">
                    Menu
                    <MoreHorizontal className="inline w-3.5 h-3.5" aria-hidden="true" />
                  </strong>{' '}
                  then{' '}
                  <strong className="inline-flex items-center gap-1 text-[var(--text-main)]">
                    Share
                    <Share className="inline w-3.5 h-3.5" aria-hidden="true" />
                  </strong>{' '}
                  in your browser bar <em>(or tap Share directly)</em>.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] shrink-0">
                  2
                </span>
                <span>
                  Scroll down and tap{' '}
                  <strong className="inline-flex items-center gap-1 text-[var(--text-main)]">
                    Add to Home Screen
                    <PlusSquare className="inline w-3.5 h-3.5" aria-hidden="true" />
                  </strong>
                  .
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] shrink-0">
                  3
                </span>
                <span>
                  Keep <strong className="text-[var(--text-main)]">Open as Web App</strong> on and tap{' '}
                  <strong className="text-[var(--text-main)]">Add</strong>.
                </span>
              </li>
            </ol>

            <div className="mt-4 flex items-center justify-center gap-1.5 text-xs font-medium text-[var(--text-muted)] sm:hidden">
              <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Use your browser toolbar below</span>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[48px] rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Got it
              </button>
              <button
                type="button"
                onClick={onDismissAppleForever}
                className="w-full min-h-[44px] rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                Already added? Don&apos;t show again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Apple macOS Safari Add to Dock Popover / Modal */}
      {sheet === 'apple-mac-safari' && (
        <div
          data-nosnippet=""
          role="dialog"
          aria-modal="true"
          aria-label="Add ExamDash to Mac Dock"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Close Dock instructions"
            onClick={onClose}
            className="fixed inset-0 h-[100lvh] bg-black/50"
          />
          <div className="relative z-10 w-full max-w-md rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Image
                  src="/assets/aistudio/exam-dash_logo_ef0c6c39.png"
                  alt="ExamDash"
                  width={40}
                  height={40}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-xl object-cover shrink-0"
                />
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-[var(--text-main)] truncate">
                    Add ExamDash to your Mac Dock
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Launch standalone study windows from macOS
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={onClose}
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <ol className="mt-4 space-y-3 text-sm text-[var(--text-muted)]">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] shrink-0">
                  1
                </span>
                <span>
                  Click{' '}
                  <strong className="inline-flex items-center gap-1 text-[var(--text-main)]">
                    Share
                    <Share className="inline w-3.5 h-3.5" aria-hidden="true" />
                  </strong>{' '}
                  in the Safari toolbar <em>(or open the <strong>File</strong> menu)</em>.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] shrink-0">
                  2
                </span>
                <span>
                  Select{' '}
                  <strong className="inline-flex items-center gap-1 text-[var(--text-main)]">
                    Add to Dock
                    <LayoutGrid className="inline w-3.5 h-3.5" aria-hidden="true" />
                  </strong>{' '}
                  and click <strong className="text-[var(--text-main)]">Add</strong>.
                </span>
              </li>
            </ol>

            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[48px] rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Got it
              </button>
              <button
                type="button"
                onClick={onDismissAppleForever}
                className="w-full min-h-[44px] rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                Already added? Don&apos;t show again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-App WebView Escape Sheet (Instagram, WhatsApp, Facebook, LinkedIn) */}
      {sheet === 'in-app-webview' && (
        <div
          data-nosnippet=""
          role="dialog"
          aria-modal="true"
          aria-label="Open in Browser to Install ExamDash"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <button
            type="button"
            aria-label="Close browser instructions"
            onClick={onClose}
            className="fixed inset-0 h-[100lvh] bg-black/50"
          />
          <div className="relative z-10 w-full sm:max-w-md rounded-t-2xl sm:rounded-[var(--radius-card)] border-t sm:border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 pb-[calc(1.25rem+var(--safe-area-inset-bottom))] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Image
                  src="/assets/aistudio/exam-dash_logo_ef0c6c39.png"
                  alt="ExamDash"
                  width={40}
                  height={40}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-xl object-cover shrink-0"
                />
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-[var(--text-main)] truncate">
                    Open in Browser to Install
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    In-app WebViews block Home Screen app installs
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={onClose}
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <ol className="mt-4 space-y-3 text-sm text-[var(--text-muted)]">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] shrink-0">
                  1
                </span>
                <span>
                  Tap the{' '}
                  <strong className="inline-flex items-center gap-1 text-[var(--text-main)]">
                    Menu
                    <MoreHorizontal className="inline w-3.5 h-3.5" aria-hidden="true" />
                  </strong>{' '}
                  icon in the corner of this app.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] shrink-0">
                  2
                </span>
                <span>
                  Choose{' '}
                  <strong className="inline-flex items-center gap-1 text-[var(--text-main)]">
                    Open in Chrome / Safari
                    <ExternalLink className="inline w-3.5 h-3.5" aria-hidden="true" />
                  </strong>{' '}
                  to enable 1-tap installation.
                </span>
              </li>
            </ol>

            <div className="mt-5 flex flex-col sm:flex-row items-stretch gap-2.5">
              <button
                type="button"
                onClick={onCopyLink}
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-4 h-4 text-[var(--status-success)]" aria-hidden="true" />
                    <span>Link Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" aria-hidden="true" />
                    <span>Copy Page Link</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 min-h-[48px] px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Embedded Preview Frame Helper */}
      {sheet === 'iframe-preview' && (
        <div
          data-nosnippet=""
          role="dialog"
          aria-modal="true"
          aria-label="Open full tab to install ExamDash"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Close install dialog"
            onClick={onClose}
            className="fixed inset-0 h-[100lvh] bg-black/50"
          />
          <div className="relative z-10 w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-6">
            <div className="flex items-center gap-3">
              <Image
                src="/assets/aistudio/exam-dash_logo_ef0c6c39.png"
                alt="ExamDash"
                width={40}
                height={40}
                referrerPolicy="no-referrer"
                className="w-10 h-10 rounded-xl object-cover shrink-0"
              />
              <div>
                <h3 className="text-base font-bold text-[var(--text-main)]">
                  Install ExamDash App
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Open in a standalone browser tab to install
                </p>
              </div>
            </div>
            <p className="mt-3.5 text-sm text-[var(--text-muted)] leading-relaxed">
              Embedded preview frames restrict native OS app prompts. Open ExamDash in a full browser tab to trigger 1-click Home Screen or Desktop installation.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <a
                href={fullTabInstallHref}
                target="_blank"
                rel="noopener"
                onClick={onClose}
                className="w-full inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                <span>Open Full Tab to Install</span>
                <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
              </a>
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[44px] rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
