import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  /** Dark button: the main action on a light page ("New loan"). */
  primary: 'bg-ink text-white hover:bg-ink-soft',
  /** Lime button: the main action on a dark surface ("Pay with MoMo"). */
  accent: 'bg-lime text-forest hover:bg-lime-deep',
  secondary: 'border border-line bg-surface text-ink hover:bg-ground',
  ghost: 'bg-transparent text-forest hover:bg-ground',
  danger: 'bg-rust text-white hover:brightness-95',
};

// Both sizes meet the 44px touch-target rule.
const SIZES: Record<ButtonSize, string> = {
  md: 'h-11 px-[18px] text-sm rounded-control',
  lg: 'h-[52px] px-6 text-base rounded-2xl',
};

/** Class names for a button. Use directly on a link that should look like a button. */
export function buttonClasses(
  opts: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string } = {},
): string {
  return cx(
    'inline-flex items-center justify-center gap-2 font-semibold no-underline',
    'cursor-pointer transition-colors select-none',
    'disabled:cursor-not-allowed disabled:opacity-55',
    VARIANTS[opts.variant ?? 'primary'],
    SIZES[opts.size ?? 'md'],
    opts.block && 'w-full',
    opts.className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container's width. */
  block?: boolean;
  /** Shows the button as busy and stops further clicks. */
  loading?: boolean;
}

export function Button({
  variant,
  size,
  block,
  loading,
  className,
  disabled,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, block, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
