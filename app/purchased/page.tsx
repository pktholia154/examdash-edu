import type { Metadata } from 'next';
import React from 'react';
import { PurchasedLibraryView } from '../../features/library/purchased-library-view';

export const metadata: Metadata = {
  title: 'Purchased Library',
  description: 'Access your purchased ExamDash ebooks, question banks, and mock exam packs.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function PurchasedPage() {
  return <PurchasedLibraryView />;
}
