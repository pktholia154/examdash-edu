'use client';

import React from 'react';
import { ThemeProvider } from '../theme/theme-provider';
import { ToastProvider } from '../toast/toast-context';
import { AuthProvider } from '../auth/auth-provider';
import { CartProvider } from '../cart/cart-provider';
import { WishlistProvider } from '../wishlist/wishlist-provider';
import { SearchModalProvider } from '../search/command-search-modal';
import { PWAInstallProvider } from '../pwa/pwa-install-provider';
import { AppShell } from './app-shell';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <WishlistProvider>
            <CartProvider>
              <SearchModalProvider>
                <PWAInstallProvider>
                  <AppShell>{children}</AppShell>
                </PWAInstallProvider>
              </SearchModalProvider>
            </CartProvider>
          </WishlistProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
