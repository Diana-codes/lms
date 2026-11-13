import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cx } from './cx';

/** Scrolls sideways on narrow screens instead of squashing its columns. */
export function Table({
  className,
  minWidth = 560,
  ...rest
}: HTMLAttributes<HTMLTableElement> & { minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table
        className={cx('w-full border-collapse text-sm', className)}
        style={{ minWidth }}
        {...rest}
      />
    </div>
  );
}

export interface CellProps {
  /** Money and other figures: right-aligned with tabular numerals. */
  numeric?: boolean;
}

export function Th({
  numeric,
  className,
  scope = 'col',
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <th
      scope={scope}
      className={cx(
        'border-b border-line px-2 pt-2 pb-2.5 text-xs font-medium text-ink-muted first:pl-0 last:pr-0',
        numeric ? 'text-right' : 'text-left',
        className,
      )}
      {...rest}
    />
  );
}

export function Td({
  numeric,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <td
      className={cx(
        'border-b border-line-soft px-2 py-3 first:pl-0 last:pr-0',
        numeric && 'text-right font-semibold tabular-nums',
        className,
      )}
      {...rest}
    />
  );
}
