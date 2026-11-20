'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw, X } from 'lucide-react';

export interface LightboxPayload {
  kind: 'image' | 'table';
  title: string;
  imageSrc?: string;
  imageAlt?: string;
  sanitizedTableHtml?: string;
}

/**
 * Full-screen Pinch-Zoom + 2D Pan Lightbox for non-reflowable diagrams, charts & wide data tables.
 */
export function DiagramLightbox({
  payload,
  onClose,
}: {
  payload: LightboxPayload | null;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);

  useEffect(() => {
    if (!payload) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, payload]);

  const clampZoom = useCallback((v: number) => {
    return Math.min(4, Math.max(1, Math.round(v * 100) / 100));
  }, []);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length >= 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistRef.current = Math.hypot(dx, dy);
      pinchStartZoomRef.current = zoom;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length >= 2 && pinchStartDistRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (Math.abs(dist - pinchStartDistRef.current) >= 8) {
        const ratio = dist / pinchStartDistRef.current;
        const damped = 1 + (ratio - 1) * 0.85;
        setZoom(clampZoom(pinchStartZoomRef.current * damped));
      }
    }
  };

  const handleTouchEnd = () => {
    pinchStartDistRef.current = null;
  };

  if (!payload) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={payload.title || 'Expanded media viewer'}
      data-nosnippet=""
      className="fixed inset-0 z-50 h-[100dvh] w-screen bg-slate-950/95 text-slate-100 flex flex-col"
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-slate-800 pt-[calc(0.75rem+var(--safe-area-inset-top))] shrink-0">
        <p className="text-sm font-semibold truncate">{payload.title}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setZoom((z) => clampZoom(z - 0.25))}
            aria-label="Zoom out"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 transition-colors"
          >
            <Minus className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            aria-label="Reset zoom"
            className="inline-flex items-center justify-center gap-1 min-h-[44px] px-3 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-semibold tabular-nums"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{Math.round(zoom * 100)}%</span>
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => clampZoom(z + 0.25))}
            aria-label="Zoom in"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close expanded view"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors ms-1"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 2D Pan + Pinch Stage */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="flex-1 overflow-auto overscroll-contain p-4 sm:p-8"
        style={{ touchAction: 'pan-x pan-y' }}
      >
        <div
          className="mx-auto transition-transform duration-150 origin-top-left"
          style={{
            width: `${Math.max(100, Math.round(zoom * 100))}%`,
          }}
        >
          {payload.kind === 'image' && payload.imageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={payload.imageSrc}
              alt={payload.imageAlt || payload.title}
              referrerPolicy="no-referrer"
              className="max-w-full h-auto mx-auto rounded-lg bg-white p-2"
            />
          ) : payload.kind === 'table' && payload.sanitizedTableHtml ? (
            <div
              className="ed-reader-skin-dark ed-md-prose max-w-none rounded-xl border border-slate-800 bg-slate-900 p-4 overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: payload.sanitizedTableHtml }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
