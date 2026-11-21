export interface LegalPageMeta {
  slug: string;
  href: string;
  title: string;
  shortTitle: string;
  summary: string;
}

export const BUSINESS_INFO = {
  legalName: 'Pardeep Kumar',
  brandName: 'Exam Kart',
  platformName: 'ExamDash',
  supportEmail: 'support@exam-kart.com',
  officialWebsite: 'https://exam-dash.com/',
  officialWebsiteOrigin: 'https://exam-dash.com',
  officeAddress:
    '1st Floor, SCO-28, Sector 13, Bhiwani, Haryana 127021, India',
  addressParts: {
    streetAddress: '1st Floor, SCO-28, Sector 13',
    addressLocality: 'Bhiwani',
    addressRegion: 'Haryana',
    postalCode: '127021',
    addressCountry: 'IN',
  },
  jurisdiction: 'Bhiwani, Haryana, India',
  supportHours:
    'Monday to Saturday, 10:00 AM – 6:00 PM IST (excluding public holidays)',
  responseSla: 'Within 24 to 48 business hours',
  refundProcessingWindow: '5 to 7 business days after approval',
  refundClaimWindow: '7 calendar days from the transaction date',
  effectiveDate: 'November 21, 2026',
  effectiveDateIso: '2026-11-21',
} as const;

export const LEGAL_PAGES: readonly LegalPageMeta[] = [
  {
    slug: 'privacy-policy',
    href: '/privacy-policy',
    title: 'Privacy Policy',
    shortTitle: 'Privacy Policy',
    summary:
      'How Exam Kart (Pardeep Kumar) collects, protects, and processes learner and Razorpay payment verification data.',
  },
  {
    slug: 'terms-of-service',
    href: '/terms-of-service',
    title: 'Terms of Service',
    shortTitle: 'Terms of Service',
    summary:
      'Binding terms governing account usage, INR pricing, Razorpay checkout, and instant digital delivery of study packs.',
  },
  {
    slug: 'refund-cancellation-policy',
    href: '/refund-cancellation-policy',
    title: 'Refund & Cancellation Policy',
    shortTitle: 'Refund & Cancellation',
    summary:
      'Clear rules for order cancellation, eligible digital refund claims, duplicate payment reversals, and 5–7 business day timelines.',
  },
  {
    slug: 'license-agreement',
    href: '/license-agreement',
    title: 'License Agreement',
    shortTitle: 'License Agreement',
    summary:
      'End-user license terms defining personal study rights, anti-piracy restrictions, and intellectual property ownership.',
  },
  {
    slug: 'contact-us',
    href: '/contact-us',
    title: 'Contact Us',
    shortTitle: 'Contact Us',
    summary:
      'Verified merchant entity details, registered Bhiwani office address, grievance redressal officer, and billing support desk.',
  },
] as const;
