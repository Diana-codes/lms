'use client';

import { type ReactNode, useEffect, useId, useRef } from 'react';
import { cx } from './cx';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One line under the title. */
  subtitle?: ReactNode;
  children: ReactNode;
  /** Buttons along the bottom, right-aligned. */
  footer?: ReactNode;
  size?: 'md' | 'lg';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog over the page. Focus moves into it, Tab stays inside it, Escape
 * and the backdrop close it, and focus returns to where it was.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: ModalProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const first =
      node?.querySelector<HTMLElement>('[data-autofocus]') ??
      node?.querySelectorAll<HTMLElement>(FOCUSABLE)[1] ??
      node;
    first?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'box-border flex max-h-full w-full flex-col gap-4 overflow-y-auto rounded-[22px] bg-surface p-6 shadow-modal outline-none',
          size === 'lg' ? 'max-w-[560px]' : 'max-w-[480px]',
        )}
      >
        <div className="flex items-start gap-3">
          <div className="mr-auto flex flex-col gap-0.5">
            <h2 id={titleId} className="m-0 font-display text-[22px] leading-tight font-semibold">
              {title}
            </h2>
            {subtitle ? <span className="text-[13px] text-ink-muted">{subtitle}</span> : null}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-11 flex-none cursor-pointer items-center justify-center rounded-full border border-line bg-surface hover:bg-ground"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
        {footer ? <div className="flex flex-wrap justify-end gap-2.5">{footer}</div> : null}
      </div>
    </div>
  );
}
