import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export type PillTone =
  'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'dark' | 'lime' | 'ai';

const TONES: Record<PillTone, string> = {
  success: 'bg-success-bg text-success-fg',
  info: 'bg-info-bg text-info-fg',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-fg',
  neutral: 'bg-neutral-bg text-neutral-fg',
  /** "Due next" on the loan schedule. */
  dark: 'bg-ink text-lime',
  /** For use on forest cards. */
  lime: 'bg-lime text-forest',
  ai: 'bg-ai-tint text-ai',
};

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
}

/** A status pill. Always pairs colour with a text label, never colour alone. */
export function Pill({ tone = 'neutral', className, ...rest }: PillProps) {
  return (
    <span
      className={cx(
        'inline-block rounded-pill px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        TONES[tone],
        className,
      )}
      {...rest}
    />
  );
}
