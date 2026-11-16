'use client';

import {
  type ButtonHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';
import { cx } from './cx';

/** A filter chip that is on or off: "SME", "Assigned to me". */
export function Chip({
  pressed,
  className,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cx(
        'inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-pill border px-3.5 text-[13px] whitespace-nowrap',
        pressed
          ? 'border-ink bg-ink font-semibold text-white'
          : 'border-line bg-surface text-ink-soft hover:bg-ground',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** One of a few large choices inside a form: payment channel, restructure option. */
export function OptionButton({
  pressed,
  hint,
  className,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> & {
  pressed: boolean;
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cx(
        'flex min-h-[46px] cursor-pointer flex-col justify-center gap-0.5 rounded-control px-3 py-2 text-sm',
        hint ? 'items-start text-left' : 'items-center text-center',
        pressed
          ? 'border-2 border-forest bg-success-bg font-semibold text-forest'
          : 'border border-line bg-surface text-ink hover:bg-ground',
        className,
      )}
      {...rest}
    >
      <span className={hint ? 'font-semibold' : undefined}>{children}</span>
      {hint ? <span className="text-xs font-normal text-ink-muted">{hint}</span> : null}
    </button>
  );
}

const fieldLabel = 'text-[13px] font-medium text-ink-soft';
const fieldBox =
  'w-full rounded-control border bg-surface px-3.5 text-sm text-ink disabled:bg-ground';

export function SelectField({
  label,
  hideLabel,
  className,
  children,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & { label: string; hideLabel?: boolean }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : fieldLabel}>
        {label}
      </label>
      <select id={id} className={cx(fieldBox, 'h-11 border-line')} {...rest}>
        {children}
      </select>
    </div>
  );
}

export function TextAreaField({
  label,
  hideLabel,
  error,
  className,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  label: string;
  /** Keep the label for screen readers only, when the placeholder says enough. */
  hideLabel?: boolean;
  error?: string | null;
}) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : fieldLabel}>
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cx(
          fieldBox,
          'resize-y py-2.5 placeholder:text-ink-muted',
          error ? 'border-rust' : 'border-line',
        )}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="m-0 text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A red box for a form-level error. */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="m-0 rounded-control bg-danger-bg px-3.5 py-2.5 text-sm text-danger-fg"
    >
      {children}
    </p>
  );
}
