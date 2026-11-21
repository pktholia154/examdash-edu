'use client';

import React, { useState } from 'react';
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
import { cn } from '../../lib/utils';
import { useAuth } from '../auth/auth-provider';
import { useCart } from '../cart/cart-provider';
import { useSearchModal } from '../search/command-search-modal';
import { useTheme } from '../theme/theme-provider';
import { CartDrawer } from '../cart/cart-drawer';
import { ClientErrorBoundary } from '../../components/ui/state-blocks';

const NAV_LINKS = [
  { label: 'Explore', href: '/' },
  { label: 'Books', href: '/books' },
  { label: 'Exams', href: '/exams' },
  { label: 'Purchased', href: '/purchased' },
];

const MOBILE_TABS = [
  { label: 'Home', href: '/', icon: Compass },
  { label: 'Books', href: '/books', icon: BookOpen },
  { label: 'Exams', href: '/exams', icon: ClipboardCheck },
  { label: 'Library', href: '/purchased', icon: Library },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const { user, isAuthReady, isSigningIn, signInWithGoogle, signOutUser, deleteAccount } =
    useAuth();
  const { summary, openCart } = useCart();
  const { openSearch } = useSearchModal();
  const { theme, toggleTheme } = useTheme();

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // On detail pages (/books/[slug] or /exams/[slug]), DetailBuyCard renders the mobile sticky bar
  // so we suppress the mobile bottom tab bar there to keep aggregate mobile sticky chrome <= 15%.
  const isDetailRoute =
    (pathname.startsWith('/books/') && pathname !== '/books') ||
    (pathname.startsWith('/exams/') && pathname !== '/exams');
  const isAttemptRoute = pathname.startsWith('/attempt/');

  return (
    <div className="min-h-[100svh] flex flex-col bg-[var(--bg-canvas)] text-[var(--text-main)]">
      {/* Sticky Top Navigation Bar (56px mobile / 64px desktop) */}
      <header className="sticky top-0 z-40 h-14 md:h-16 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 backdrop-blur-md">
        <div className="ed-container h-full flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <Link
            href="/"
            className="text-lg font-extrabold tracking-tight text-[var(--text-main)] whitespace-nowrap shrink-0"
          >
            ExamDash
          </Link>

          {/* Zone 2: Concise Single-Line Navigation Links */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium"
          >
            {NAV_LINKS.map((link) => {
              const isActive =
                link.href === '/'
                  ? pathname === '/'
                  : pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'py-1 transition-colors whitespace-nowrap shrink-0 hover:text-[var(--text-main)] hover:underline underline-offset-8 decoration-2',
                    isActive
                      ? 'text-[var(--text-main)] font-semibold underline'
                      : 'text-[var(--text-muted)]'
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* Zone 3: Compact Action Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              aria-label="Search catalog (Command K)"
              onClick={() => openSearch()}
              className="inline-flex items-center justify-center gap-2 min-h-[40px] px-2.5 sm:px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap shrink-0"
            >
              <Search className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="hidden lg:inline">Search</span>
              <kbd className="hidden sm:inline font-mono text-[11px] text-[var(--text-muted)]">
                ⌘K
              </kbd>
            </button>

            <button
              type="button"
              aria-label={
                theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
              }
              onClick={toggleTheme}
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors shrink-0"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Moon className="w-4 h-4" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              aria-label={`Open shopping cart (${summary.itemCount} items)`}
              onClick={openCart}
              className="relative inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors tabular-nums whitespace-nowrap shrink-0"
            >
              <ShoppingBag className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{summary.itemCount}</span>
            </button>

            {!isAuthReady ? (
              <div className="w-20 h-10 rounded-lg ed-skeleton shrink-0" />
            ) : user ? (
              <div className="relative" data-nosnippet="">
                <button
                  type="button"
                  aria-label="Account menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((prev) => !prev)}
                  className="inline-flex items-center justify-center gap-2 min-h-[40px] px-3 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
                >
                  <UserIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="max-w-[100px] truncate">
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
                      className="absolute right-0 mt-2 z-40 w-60 rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-2 shadow-lg"
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
                        href="/purchased"
                        role="menuitem"
                        onClick={() => setMenuOpen(false)}
                        className="mt-1 flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
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
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors text-left"
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
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)] transition-colors text-left"
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
                className="inline-flex items-center justify-center min-h-[40px] px-3.5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap shrink-0"
              >
                {isSigningIn ? 'Signing in...' : 'Sign In'}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main
        id="main-content"
        className={cn('flex-1', isAttemptRoute ? 'pb-6' : 'pb-20 md:pb-12')}
      >
        <ClientErrorBoundary>{children}</ClientErrorBoundary>
      </main>

      {/* Quiet Editorial Footer (suppressed on /attempt/* CBT workstation routes) */}
      {!isAttemptRoute && (
        <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] py-8 pb-24 md:pb-8">
          <div className="ed-container flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[var(--text-muted)]">
            <p>© {new Date().getFullYear()} ExamDash (ed). Digital Study Catalog & Mock Test Platform.</p>
            <nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-5">
              <Link href="/books" className="hover:text-[var(--text-main)] transition-colors">
                Books Catalog
              </Link>
              <Link href="/exams" className="hover:text-[var(--text-main)] transition-colors">
                Exam Packs
              </Link>
              <Link href="/purchased" className="hover:text-[var(--text-main)] transition-colors">
                Study Library
              </Link>
              <a href="/sitemap.xml" className="hover:text-[var(--text-main)] transition-colors">
                Sitemap
              </a>
            </nav>
          </div>
        </footer>
      )}

      {/* Mobile Safe-Area Bottom Tab Bar (56px, suppressed on detail and CBT routes) */}
      {!isDetailRoute && !isAttemptRoute && (
        <nav
          data-nosnippet=""
          aria-label="Mobile navigation"
          className="md:hidden fixed bottom-0 inset-x-0 z-30 h-14 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 backdrop-blur-md pb-[var(--safe-area-inset-bottom)]"
        >
          <div className="grid grid-cols-4 h-full">
            {MOBILE_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive =
                tab.href === '/'
                  ? pathname === '/'
                  : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors chrome-no-select',
                    isActive ? 'text-[var(--text-main)] font-semibold' : 'text-[var(--text-muted)]'
                  )}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  <span>{tab.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {/* Slide-Over Shopping Cart */}
      <CartDrawer />

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
            className="fixed inset-0 h-[100lvh] bg-slate-950/50 backdrop-blur-[2px]"
          />
          <div className="relative z-10 w-full max-w-md rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-6 shadow-xl">
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
