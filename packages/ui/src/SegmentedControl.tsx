'use client';

import { cx } from './cx';

export interface SegmentedControlProps<T extends string> {
  /** Names the group for screen readers, e.g. "Range". */
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** A small set of mutually exclusive choices: 3M / 12M, Board / List. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx('inline-flex rounded-nav bg-ground p-[3px]', className)}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cx(
              // The visible chip is compact; the padding keeps the hit area usable.
              'min-h-8 min-w-11 cursor-pointer rounded-lg border-0 px-2.5 py-1.5 text-xs',
              on
                ? 'bg-surface font-semibold text-ink shadow-segment'
                : 'bg-transparent text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
