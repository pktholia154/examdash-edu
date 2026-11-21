'use client';

export interface RazorpaySuccessPayload {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayErrorPayload {
  error?: {
    code?: string;
    description?: string;
    source?: string;
    step?: string;
    reason?: string;
  };
}

export interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  image?: string;
  order_id: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  notes?: Record<string, string>;
  theme?: {
    color?: string;
  };
  modal?: {
    ondismiss?: () => void;
    escape?: boolean;
    confirm_close?: boolean;
  };
  handler: (response: RazorpaySuccessPayload) => void;
}

interface RazorpayInstance {
  open: () => void;
  close: () => void;
  on: (
    event: 'payment.failed',
    handler: (payload: RazorpayErrorPayload) => void
  ) => void;
}

type RazorpayConstructor = new (
  options: RazorpayCheckoutOptions
) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let scriptPromise: Promise<RazorpayConstructor> | null = null;

/**
 * Lazily loads the official production Razorpay Checkout.js script on demand
 * (zero impact on first-byte HTML / SSR / Core Web Vitals).
 */
export function loadRazorpayCheckoutScript(): Promise<RazorpayConstructor> {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new Error('Razorpay Checkout can only be opened in a browser.')
    );
  }

  if (typeof window.Razorpay === 'function') {
    return Promise.resolve(window.Razorpay);
  }

  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise<RazorpayConstructor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${RAZORPAY_SCRIPT_SRC}"]`
    );
    if (existing) {
      if (typeof window.Razorpay === 'function') {
        resolve(window.Razorpay);
        return;
      }
      existing.addEventListener('load', () => {
        if (typeof window.Razorpay === 'function') {
          resolve(window.Razorpay);
        } else {
          scriptPromise = null;
          reject(new Error('Razorpay Checkout SDK failed to initialize.'));
        }
      });
      existing.addEventListener('error', () => {
        scriptPromise = null;
        reject(new Error('Unable to load Razorpay Checkout. Check your network connection.'));
      });
      return;
    }

    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_SRC;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      if (typeof window.Razorpay === 'function') {
        resolve(window.Razorpay);
      } else {
        scriptPromise = null;
        reject(new Error('Razorpay Checkout SDK loaded without exposing Razorpay.'));
      }
    };
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Unable to load Razorpay Checkout script. Please try again.'));
    };
    document.body.appendChild(script);
  });

  return scriptPromise;
}

export type RazorpayModalOutcome =
  | { status: 'paid'; payload: RazorpaySuccessPayload }
  | { status: 'dismissed' }
  | { status: 'failed'; message: string };

/**
 * Opens the production Razorpay Checkout modal and resolves when the user completes payment,
 * dismisses the modal, or receives a gateway failure event.
 */
export async function openRazorpayCheckoutModal(
  options: Omit<RazorpayCheckoutOptions, 'handler' | 'modal'>
): Promise<RazorpayModalOutcome> {
  const RazorpayCtor = await loadRazorpayCheckoutScript();

  return new Promise<RazorpayModalOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: RazorpayModalOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const instance = new RazorpayCtor({
      ...options,
      modal: {
        confirm_close: true,
        escape: true,
        ondismiss: () => {
          finish({ status: 'dismissed' });
        },
      },
      handler: (response: RazorpaySuccessPayload) => {
        finish({ status: 'paid', payload: response });
      },
    });

    instance.on('payment.failed', (errPayload: RazorpayErrorPayload) => {
      const description =
        errPayload?.error?.description ||
        errPayload?.error?.reason ||
        'Payment failed at the gateway. No charges were captured.';
      finish({ status: 'failed', message: description });
    });

    instance.open();
  });
}
