import type { ProductStatus } from '@/lib/types';

export const STATUS_PILL: Record<
  ProductStatus,
  { tone: 'success' | 'warning' | 'neutral'; label: string }
> = {
  PUBLISHED: { tone: 'success', label: 'Published' },
  DRAFT: { tone: 'warning', label: 'Draft' },
  RETIRED: { tone: 'neutral', label: 'Retired' },
};
