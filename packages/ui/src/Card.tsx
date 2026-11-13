import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export type CardTone = 'surface' | 'forest' | 'ai' | 'caution';

const TONES: Record<CardTone, string> = {
  surface: 'bg-surface border border-line text-ink',
  forest: 'bg-forest text-white',
  ai: 'bg-ai-tint border border-ai-line text-ink',
  caution: 'bg-caution-bg text-caution-ink',
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  /** Tighter padding and radius, for panels nested inside a card. */
  compact?: boolean;
}

export function Card({ tone = 'surface', compact, className, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        'flex min-w-0 flex-col',
        compact ? 'gap-2 rounded-panel p-3.5' : 'gap-4 rounded-card p-6',
        TONES[tone],
        className,
      )}
      {...rest}
    />
  );
}

export function CardTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cx('m-0 font-display text-lg font-semibold', className)} {...rest} />;
}
