import type { ReactNode } from 'react';
import { cx } from './cx';

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** A delta, a progress bar or a short note under the number. */
  children?: ReactNode;
  /** The forest tile is for the single most important figure on a page. */
  tone?: 'surface' | 'forest';
  className?: string;
}

/** A headline metric, as in the row at the top of the Overview. */
export function StatTile({ label, value, children, tone = 'surface', className }: StatTileProps) {
  const forest = tone === 'forest';
  return (
    <div
      className={cx(
        'flex flex-col gap-3.5 rounded-card p-[22px]',
        forest ? 'bg-forest text-white' : 'border border-line bg-surface',
        className,
      )}
    >
      <span className={cx('text-[13px]', forest ? 'text-forest-muted' : 'text-ink-muted')}>
        {label}
      </span>
      <span className="font-display text-[32px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
        {value}
      </span>
      {children}
    </div>
  );
}
