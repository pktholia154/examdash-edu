'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  ClipboardCheck,
  Compass,
  Library,
  LogOut,
  Moon,
  Search,
  ShoppingBag,
  Sun,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { ClientErrorBoundary } from '../../components/ui/state-blocks';
import { BUSINESS_INFO, LEGAL_PAGES } from '../../lib/legal/business-info';
import {
  resolveMobileTabState,
  shouldShowMobileBottomNav,
} from '../../lib/navigation/mobile-nav';
import { cn } from '../../lib/utils';
import { useAuth } from '../auth/auth-provider';
import { useCart } from '../cart/cart-provider';
import { useSearchModal } from '../search/command-search-modal';
import { HeaderPwaAction, MobileOpenInAppBanner } from '../pwa/install-banner';
import { useTheme } from '../theme/theme-provider';

const LazyCartDrawer = dynamic(
  () => import('../cart/cart-drawer').then((m) => m.CartDrawer),
  { ssr: false }
);

const NAV_LINKS = [
  { label: 'Explore', href: '/' },
  { label: 'Books', href: '/books' },
  { label: 'Exams', href: '/exams' },
  { label: 'Purchased', href: '/purchased' },
  { label: 'Profile', href: '/profile' },
];

const MOBILE_TABS = [
  { label: 'Home', href: '/', icon: Compass },
  { label: 'Books', href: '/books', icon: BookOpen },
  { label: 'Exams', href: '/exams', icon: ClipboardCheck },
  { label: 'Purchased', href: '/purchased', icon: Library },
  { label: 'Profile', href: '/profile', icon: UserIcon },
];

const COPYRIGHT_YEAR = BUSINESS_INFO.effectiveDateIso.slice(0, 4) || '2026';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const {
    user,
    isRestoringSession,
    isSigningIn,
    signInWithGoogle,
    signOutUser,
    deleteAccount,
  } = useAuth();
  const { summary, isOpen: isCartOpen, openCart } = useCart();
  const { openSearch } = useSearchModal();
  const { toggleTheme } = useTheme();

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const isDetailRoute =
    (pathname.startsWith('/books/') && pathname !== '/books') ||
    (pathname.startsWith('/exams/') && pathname !== '/exams');
  const isAttemptRoute = pathname.startsWith('/attempt/');
  const isReaderRoute = pathname.startsWith('/read/');
  const showMobileBottomNav = shouldShowMobileBottomNav(pathname);

  if (isReaderRoute) {
    return <ClientErrorBoundary>{children}</ClientErrorBoundary>;
  }

  return (
    <div className="min-h-[100svh] max-md:min-h-[100dvh] max-md:w-full max-md:max-w-full max-md:overflow-x-clip flex flex-col bg-[var(--bg-canvas)] text-[var(--text-main)]">
      {/* Sticky Top Navigation Bar (Solid Matte, Zero Blur, 48px desktop / 44px mobile touch targets) */}
      <header className="sticky top-0 z-40 h-15 md:h-16 max-md:h-[calc(3.375rem+var(--safe-area-inset-top))] max-md:pt-[var(--safe-area-inset-top)] border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="ed-container h-full flex items-center justify-between gap-4 sm:gap-8 max-md:gap-2">
          {/* Zone 1: Single-line Brand Logo & Wordmark */}
          <Link
            href="/"
            prefetch={false}
            className="inline-flex items-center gap-2.5 max-md:gap-2 min-h-[48px] max-md:min-h-[44px] text-lg max-md:text-base font-extrabold tracking-tight text-[var(--text-main)] whitespace-nowrap shrink-0 min-w-0"
          >
            <Image
              src="/assets/aistudio/exam-dash_logo_ef0c6c39.png"
              alt="ExamDash logo"
              width={36}
              height={36}
              priority
              referrerPolicy="no-referrer"
              className="w-9 h-9 max-md:w-8 max-md:h-8 rounded-lg object-cover shrink-0"
            />
            <span className="max-[359px]:sr-only">ExamDash</span>
          </Link>

          {/* Zone 2: Concise Single-Line Navigation Links (aria-current="page" strictly on exact pathname match) */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium"
          >
            {NAV_LINKS.map((link) => {
              const isExactPage = pathname === link.href;
              const isSectionMatch =
                link.href === '/'
                  ? pathname === '/'
                  : pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  prefetch={false}
                  aria-current={isExactPage ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center min-h-[48px] transition-colors whitespace-nowrap shrink-0 hover:text-[var(--text-main)] hover:underline underline-offset-8 decoration-2',
                    isSectionMatch
                      ? 'text-[var(--text-main)] font-semibold underline'
                      : 'text-[var(--text-muted)]'
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* Zone 3: Compact Action Controls (48px desktop, 44px zero-overflow mobile) */}
          <div className="flex items-center gap-2 max-md:gap-1.5 shrink-0 min-w-0">
            <HeaderPwaAction />

            <button
              type="button"
              aria-label="Search catalog (Command K)"
              onClick={() => openSearch()}
              className="inline-flex items-center justify-center gap-2 min-h-[48px] min-w-[48px] max-md:min-h-[44px] max-md:min-w-[44px] px-3 max-md:px-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap shrink-0"
            >
              <Search className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="hidden lg:inline">Search</span>
              <kbd className="hidden md:inline font-mono text-[11px] text-[var(--text-muted)]">
                ⌘K
              </kbd>
            </button>

            <button
              type="button"
              aria-label="Toggle color theme"
              onClick={toggleTheme}
              className="inline-flex items-center justify-center min-h-[48px] min-w-[48px] max-md:min-h-[44px] max-md:min-w-[44px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors shrink-0"
            >
              <Sun className="hidden dark:block w-4 h-4" aria-hidden="true" />
              <Moon className="block dark:hidden w-4 h-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              aria-label={`Open shopping cart (${summary.itemCount} items)`}
              onClick={openCart}
              className="relative inline-flex items-center justify-center gap-1.5 max-md:gap-1 min-h-[48px] min-w-[48px] max-md:min-h-[44px] max-md:min-w-[44px] px-3 max-md:px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors tabular-nums whitespace-nowrap shrink-0"
            >
              <ShoppingBag className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{summary.itemCount}</span>
            </button>

            {isRestoringSession ? (
              <div className="w-20 h-12 max-md:w-14 max-md:h-11 rounded-lg ed-skeleton shrink-0" />
            ) : user ? (
              <div className="relative min-w-0" data-nosnippet="">
                <button
                  type="button"
                  aria-label="Account menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((prev) => !prev)}
                  className="inline-flex items-center justify-center gap-2 max-md:gap-1.5 min-h-[48px] max-md:min-h-[44px] px-3.5 max-md:px-2.5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
                >
                  <UserIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="max-w-[100px] max-md:max-w-[60px] truncate">
                    {user.displayName?.split(' ')[0] || 'Account'}
                  </span>
                </button>

                {menuOpen && (
                  <>
                    <button
                      type="button"
                      aria-label="Close account menu"
                      onClick={() => setMenuOpen(false)}
                      className="fixed inset-0 z-30 cursor-default"
                    />
                    <div
                      role="menu"
                      className="absolute right-0 mt-2 z-40 w-60 max-md:w-[min(15rem,calc(100vw-1.5rem))] rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-2"
                    >
                      <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
                        <p className="text-sm font-semibold text-[var(--text-main)] truncate">
                          {user.displayName || 'ExamDash Learner'}
                        </p>
                        <p className="text-xs text-[var(--text-muted)] truncate">
                          {user.email}
                        </p>
                      </div>

                      <Link
                        href="/profile"
                        prefetch={false}
                        role="menuitem"
                        onClick={() => setMenuOpen(false)}
                        className="mt-1 flex items-center gap-2.5 min-h-[48px] px-3 rounded-lg text-sm text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
                      >
                        <UserIcon className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
                        <span>Profile &amp; Wishlist</span>
                      </Link>

                      <Link
                        href="/purchased"
                        prefetch={false}
                        role="menuitem"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2.5 min-h-[48px] px-3 rounded-lg text-sm text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
                      >
                        <Library className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
                        <span>Purchased Library</span>
                      </Link>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          void signOutUser();
                        }}
                        className="w-full flex items-center gap-2.5 min-h-[48px] px-3 rounded-lg text-sm text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors text-left"
                      >
                        <LogOut className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
                        <span>Sign Out</span>
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          setConfirmDeleteOpen(true);
                        }}
                        className="w-full flex items-center gap-2.5 min-h-[48px] px-3 rounded-lg text-sm text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)] transition-colors text-left"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                        <span>Delete Account</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button
                type="button"
                disabled={isSigningIn}
                onClick={() => void signInWithGoogle()}
                className="inline-flex items-center justify-center min-h-[48px] max-md:min-h-[44px] px-4 max-md:px-3 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap shrink-0"
              >
                {isSigningIn ? 'Signing in...' : 'Sign In'}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Open-in-App Deep-Link Strip on Non-Home, Non-Detail Routes */}
      {pathname !== '/' && !isDetailRoute && !isAttemptRoute && <MobileOpenInAppBanner />}

      {/* Main Content Area */}
      <main
        id="main-content"
        className={cn(
          'flex-1 min-w-0',
          isAttemptRoute ? 'pb-6' : 'pb-20 max-md:pb-8 md:pb-12'
        )}
      >
        <ClientErrorBoundary>{children}</ClientErrorBoundary>
      </main>

      {/* Quiet Editorial Footer (suppressed on /attempt/* CBT workstation routes) */}
      {!isAttemptRoute && (
        <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] py-8 pb-24 max-md:py-6 max-md:pb-[calc(4.75rem+var(--safe-area-inset-bottom))] md:pb-8">
          <div className="ed-container space-y-5 max-md:space-y-4 text-xs text-[var(--text-muted)]">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 max-md:gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-[var(--text-main)]">
                  © {COPYRIGHT_YEAR} {BUSINESS_INFO.brandName} — Operated by{' '}
                  {BUSINESS_INFO.legalName}
                </p>
                <p className="mt-1 break-words">
                  {BUSINESS_INFO.officeAddress} ·{' '}
                  <a
                    href={`mailto:${BUSINESS_INFO.supportEmail}`}
                    className="hover:text-[var(--text-main)] underline underline-offset-4 transition-colors"
                  >
                    {BUSINESS_INFO.supportEmail}
                  </a>
                </p>
              </div>
              <nav
                aria-label="Catalog navigation"
                className="flex flex-wrap items-center gap-5 max-md:gap-x-4 max-md:gap-y-0"
              >
                <Link
                  href="/books"
                  prefetch={false}
                  className="max-md:min-h-[44px] max-md:inline-flex max-md:items-center hover:text-[var(--text-main)] transition-colors"
                >
                  Books Catalog
                </Link>
                <Link
                  href="/exams"
                  prefetch={false}
                  className="max-md:min-h-[44px] max-md:inline-flex max-md:items-center hover:text-[var(--text-main)] transition-colors"
                >
                  Exam Packs
                </Link>
                <Link
                  href="/purchased"
                  prefetch={false}
                  className="max-md:min-h-[44px] max-md:inline-flex max-md:items-center hover:text-[var(--text-main)] transition-colors"
                >
                  Study Library
                </Link>
                <a
                  href="/sitemap.xml"
                  className="max-md:min-h-[44px] max-md:inline-flex max-md:items-center hover:text-[var(--text-main)] transition-colors"
                >
                  Sitemap
                </a>
              </nav>
            </div>

            <nav
              aria-label="Legal and compliance policies"
              className="pt-4 max-md:pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-x-5 gap-y-2 max-md:gap-x-4 max-md:gap-y-0"
            >
              {LEGAL_PAGES.map((page) => (
                <Link
                  key={page.href}
                  href={page.href}
                  prefetch={false}
                  className="max-md:min-h-[44px] max-md:inline-flex max-md:items-center hover:text-[var(--text-main)] hover:underline underline-offset-4 transition-colors whitespace-nowrap"
                >
                  {page.title}
                </Link>
              ))}
            </nav>
          </div>
        </footer>
      )}

      {/* Award-Winning Mobile Safe-Area Bottom Navigation Bar (All Major & Product Detail Pages) */}
      {showMobileBottomNav && (
        <nav
          data-nosnippet=""
          aria-label="Mobile navigation"
          className="md:hidden fixed bottom-0 inset-x-0 z-30 ed-mobile-tabbar border-t border-[var(--border-subtle)]"
        >
          <div className="grid grid-cols-5 h-[3.75rem] items-center">
            {MOBILE_TABS.map((tab) => {
              const Icon = tab.icon;
              const { isExactPage, isActiveSection } = resolveMobileTabState(
                pathname,
                tab.href
              );
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  prefetch={false}
                  aria-current={isExactPage ? 'page' : undefined}
                  className={cn(
                    'relative flex flex-col items-center justify-center gap-1 min-h-[48px] h-full min-w-0 px-1 rounded-xl transition-transform duration-150 active:scale-[0.95] chrome-no-select',
                    isActiveSection
                      ? 'text-[var(--text-main)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  )}
                >
                  <span
                    className={cn(
                      'w-12 h-7 rounded-full inline-flex items-center justify-center transition-colors duration-150',
                      isActiveSection
                        ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                        : 'bg-transparent text-current'
                    )}
                  >
                    <Icon
                      className={cn(
                        'w-[18px] h-[18px] shrink-0',
                        isActiveSection && 'stroke-[2.25]'
                      )}
                      aria-hidden="true"
                    />
                  </span>
                  <span
                    className={cn(
                      'text-[10.5px] leading-none tracking-tight whitespace-nowrap truncate max-w-full',
                      isActiveSection ? 'font-bold' : 'font-medium'
                    )}
                  >
                    {tab.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {/* Lazy Slide-Over Shopping Cart (mounted strictly when opened) */}
      {isCartOpen && <LazyCartDrawer />}

      {/* Self-Serve Account Deletion Confirmation Modal (Pillar 9 Store Mandate) */}
      {confirmDeleteOpen && (
        <div
          data-nosnippet=""
          role="dialog"
          aria-modal="true"
          aria-label="Confirm account deletion"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Cancel account deletion"
            onClick={() => setConfirmDeleteOpen(false)}
            className="fixed inset-0 h-[100lvh] bg-black/50"
          />
          <div className="relative z-10 w-full max-w-md rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-6">
            <h2 className="text-base font-bold text-[var(--text-main)]">
              Delete your ExamDash account?
            </h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              This permanently removes your ExamDash profile and contact information. This action cannot be undone.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(false)}
                className="min-h-[48px] px-4 rounded-lg border border-[var(--border-subtle)] text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteOpen(false);
                  void deleteAccount();
                }}
                className="min-h-[48px] px-4 rounded-lg bg-[var(--status-danger)] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
