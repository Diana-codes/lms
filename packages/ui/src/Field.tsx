'use client';

import { type InputHTMLAttributes, useId } from 'react';
import { cx } from './cx';
import { SearchIcon } from './icons';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
  /** Keep the label for screen readers only (rows of inputs under one heading). */
  hideLabel?: boolean;
}

/** A labelled text input. The label is a real <label>, and errors are announced. */
export function TextField({ label, hint, error, hideLabel, className, ...rest }: TextFieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'text-[13px] font-medium text-ink-soft'}
      >
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          'h-11 w-full rounded-control border bg-surface px-3.5 text-sm text-ink',
          'placeholder:text-ink-muted disabled:bg-ground',
          error ? 'border-rust' : 'border-line',
        )}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="m-0 text-[13px] text-danger-fg">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="m-0 text-[13px] text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Read by screen readers; the placeholder alone is not a label. */
  label?: string;
}

export function SearchInput({ label = 'Search', className, ...rest }: SearchInputProps) {
  return (
    <label
      className={cx(
        'flex h-11 min-w-60 items-center gap-2 rounded-control border border-line bg-surface px-3.5',
        'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-forest',
        className,
      )}
    >
      <SearchIcon size={16} className="flex-none text-ink-muted" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        className="w-full border-0 bg-transparent text-sm outline-none placeholder:text-ink-muted"
        {...rest}
      />
    </label>
  );
}
