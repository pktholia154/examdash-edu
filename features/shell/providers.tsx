'use client';

import React from 'react';
import { ThemeProvider } from '../theme/theme-provider';
import { ToastProvider } from '../toast/toast-context';
import { AuthProvider } from '../auth/auth-provider';
import { CartProvider } from '../cart/cart-provider';
import { SearchModalProvider } from '../search/command-search-modal';
import { AppShell } from './app-shell';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <CartProvider>
            <SearchModalProvider>
              <AppShell>{children}</AppShell>
            </SearchModalProvider>
          </CartProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
