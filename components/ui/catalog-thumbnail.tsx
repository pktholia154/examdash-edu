'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { BookOpen, FileCheck2 } from 'lucide-react';
import type { CollectionName, ImageMetaDTO } from '../../lib/types/catalog';
import { cn } from '../../lib/utils';

export interface CatalogThumbnailProps {
  title: string;
  collectionName: CollectionName;
  imageUrl?: string;
  imageMeta?: ImageMetaDTO;
  imageAlt?: string;
  imageTitle?: string;
  size?: 'xs' | 'sm' | 'list' | 'lg' | 'card';
  priority?: boolean;
  className?: string;
}

/**
 * Strict 4:3 portrait cover ratio (`aspect-[3/4]`, height:breadth = 4:3)
 * matching Firestore `.png` cover artwork across all catalog, cart, search,
 * library, carousel, and detail views.
 */
const SIZE_CLASSES: Record<NonNullable<CatalogThumbnailProps['size']>, string> = {
  xs: 'w-9 h-12',
  sm: 'w-12 h-16',
  list: 'w-[84px] h-[112px] md:w-[90px] md:h-[120px]',
  lg: 'w-[90px] h-[120px] sm:w-[108px] sm:h-[144px] md:w-[126px] md:h-[168px]',
  card: 'w-full',
};

const FIXED_DIMENSIONS: Partial<
  Record<
    NonNullable<CatalogThumbnailProps['size']>,
    { width: number; height: number }
  >
> = {
  xs: { width: 48, height: 64 },
  sm: { width: 64, height: 85 },
  list: { width: 96, height: 128 },
  lg: { width: 128, height: 171 },
};

const CARD_SIZES_HINT = '(max-width: 767px) 30vw, (max-width: 1023px) 19vw, 14vw';

const ICON_SIZES: Record<NonNullable<CatalogThumbnailProps['size']>, string> = {
  xs: 'w-4 h-4',
  sm: 'w-5 h-5',
  list: 'w-6 h-6',
  lg: 'w-8 h-8',
  card: 'w-7 h-7',
};

export function CatalogThumbnail({
  title,
  collectionName,
  imageUrl,
  imageMeta,
  imageAlt,
  imageTitle,
  size = 'list',
  priority = false,
  className,
}: CatalogThumbnailProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const cleanUrl = (imageUrl || '').trim();
  const canShowImage = Boolean(cleanUrl && failedSrc !== cleanUrl);

  const resolvedAlt =
    imageAlt?.trim() ||
    imageMeta?.alt?.trim() ||
    `${title} ${collectionName === 'books' ? 'book cover' : 'exam pack cover'}`;
  const resolvedTitle =
    imageTitle?.trim() || imageMeta?.title?.trim() || title;

  const FallbackIcon =
    collectionName === 'ExamPackDocument' ? FileCheck2 : BookOpen;
  const fixedDims = FIXED_DIMENSIONS[size];
  const quality = 75;
  const fetchPriority = priority ? 'high' : 'low';

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden aspect-[3/4] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] select-none',
        collectionName === 'books'
          ? 'rounded-none'
          : 'rounded-[var(--radius-thumb)]',
        SIZE_CLASSES[size],
        className
      )}
    >
      {canShowImage ? (
        fixedDims ? (
          <Image
            src={cleanUrl}
            alt={resolvedAlt}
            title={resolvedTitle}
            width={fixedDims.width}
            height={fixedDims.height}
            quality={quality}
            priority={priority}
            fetchPriority={fetchPriority}
            referrerPolicy="no-referrer"
            onError={() => setFailedSrc(cleanUrl)}
            className="w-full h-full object-cover"
          />
        ) : (
          <Image
            src={cleanUrl}
            alt={resolvedAlt}
            title={resolvedTitle}
            fill
            sizes={CARD_SIZES_HINT}
            quality={quality}
            priority={priority}
            fetchPriority={fetchPriority}
            referrerPolicy="no-referrer"
            onError={() => setFailedSrc(cleanUrl)}
            className="object-cover"
          />
        )
      ) : (
        <div
          role="img"
          aria-label={resolvedAlt}
          className="w-full h-full flex items-center justify-center text-[var(--text-muted)]"
        >
          <FallbackIcon
            className={cn(ICON_SIZES[size], 'opacity-70 shrink-0')}
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
}
