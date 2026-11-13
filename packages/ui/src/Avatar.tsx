import { initials } from '@kora/core';
import { cx } from './cx';

export interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = { sm: 'size-7 text-[11px]', md: 'size-[34px] text-xs', lg: 'size-14 text-lg' };

/** Initials in a circle. Decorative: the name is always shown next to it. */
export function Avatar({ name, size = 'md', className }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex flex-none items-center justify-center rounded-full bg-avatar-bg font-semibold text-forest',
        SIZES[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
