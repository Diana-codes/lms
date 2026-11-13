import { cx } from './cx';

// Kept out of Controls.tsx on purpose: that file is browser-only, and this
// helper is called from server-rendered pages.

/** Class names for a chip-shaped link, for filters that live in the URL. */
export function chipClasses(active: boolean, className?: string): string {
  return cx(
    'inline-flex h-11 items-center gap-1.5 rounded-pill border px-3.5 text-[13px] whitespace-nowrap no-underline',
    active
      ? 'border-ink bg-ink font-semibold text-white hover:text-white'
      : 'border-line bg-surface text-ink-soft hover:bg-ground hover:text-ink',
    className,
  );
}
