/**
 * Featured loan products shown on the landing page.
 *
 * Values follow PRD v1.3 Appendix A (indicative market defaults).
 * TODO(BF): Replace with published products from the loan product API
 * (PRD §4.6) once the internal system exists. Management must approve
 * all amounts and terms before launch.
 */
export type ProductKey =
  'salary' | 'business' | 'group' | 'asset' | 'emergency' | 'personal' | 'agri';

export const featuredProducts: {
  key: ProductKey;
  minAmount: number;
  maxAmount: number | null; // null = shown as "up to 80% of asset value"
  minTermMonths: number;
  maxTermMonths: number;
}[] = [
  { key: 'salary', minAmount: 100_000, maxAmount: 10_000_000, minTermMonths: 3, maxTermMonths: 36 },
  {
    key: 'business',
    minAmount: 500_000,
    maxAmount: 30_000_000,
    minTermMonths: 3,
    maxTermMonths: 24,
  },
  { key: 'group', minAmount: 50_000, maxAmount: 1_000_000, minTermMonths: 3, maxTermMonths: 12 },
  {
    key: 'asset',
    minAmount: 1_000_000,
    maxAmount: 30_000_000,
    minTermMonths: 6,
    maxTermMonths: 36,
  },
];

export const formatRwf = (amount: number) => `RWF ${new Intl.NumberFormat('en-US').format(amount)}`;
