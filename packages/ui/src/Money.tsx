import { formatRwf, formatRwfCompact, parseRwf } from '@kora/core';
import { cx } from './cx';

export interface MoneyProps {
  /**
   * Whole RWF, as a bigint or the digit string the API sends (a leading "-"
   * for negative figures such as a net loss). Never a float.
   */
  amount: bigint | string;
  /** "RWF 2.48B" instead of "RWF 2,480,000,000", for headline figures. */
  compact?: boolean;
  /** Leave out "RWF", for table columns whose header already says it. */
  bare?: boolean;
  className?: string;
}

/** An RWF amount with thousands separators and tabular numerals. */
export function Money({ amount, compact, bare, className }: MoneyProps) {
  const value =
    typeof amount === 'string'
      ? amount.trim().startsWith('-')
        ? -parseRwf(amount.trim().slice(1))
        : parseRwf(amount)
      : amount;
  const text = (compact ? formatRwfCompact : formatRwf)(value, { symbol: !bare });
  return <span className={cx('tabular-nums whitespace-nowrap', className)}>{text}</span>;
}
