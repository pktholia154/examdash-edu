import type { Metadata } from 'next';
import React from 'react';
import {
  ProfilePageView,
  type ProfileBookRef,
} from '../../features/profile/profile-page-view';
import { getLiveBooks } from '../../server/repositories/catalog-repository';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My Profile & Study Analytics',
  description:
    'View your ExamDash profile, reading and mock exam analytics, saved wishlist, and app sharing tools.',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ProfileRoutePage() {
  const books = await getLiveBooks();
  const booksCatalog: ProfileBookRef[] = books.map((b) => ({
    id: b.id,
    urlSlug: b.urlSlug,
    title: b.title,
    type: b.type,
  }));

  return <ProfilePageView booksCatalog={booksCatalog} />;
}
