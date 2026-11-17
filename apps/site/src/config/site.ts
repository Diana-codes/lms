/**
 * Site-wide settings for the public website.
 *
 * TODO(BF): Replace every value marked PLACEHOLDER with details approved by
 * Bridge to Finance management before launch (PRD §4.3: all public claims
 * must be approved).
 */
export const site = {
  name: 'Bridge to Finance',
  /** Slogans live in the dictionaries (`slogans`), so they can be translated. */

  /** Logo: see src/components/BfMark.tsx and public/brand/. */

  contact: {
    address: 'Kigali, Rwanda', // PLACEHOLDER – full office address
    phone: '+250 7XX XXX XXX', // PLACEHOLDER
    phoneHref: 'tel:+250700000000', // PLACEHOLDER
    email: 'info@bridgetofinance.rw', // PLACEHOLDER – confirm domain
  },

  /** PLACEHOLDER – BNR licence reference shown in the footer once confirmed. */
  licenceNumber: null as string | null,
} as const;
