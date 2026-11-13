import type { ReactNode } from 'react';
import { cx } from './cx';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** What a list or page shows when there is nothing in it yet. */
export function EmptyState({ icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        'flex flex-col items-center gap-3 rounded-card border border-dashed border-line bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <span className="flex size-12 items-center justify-center rounded-panel bg-ground text-forest">
          {icon}
        </span>
      ) : null}
      <h2 className="m-0 font-display text-lg font-semibold">{title}</h2>
      {children ? <p className="m-0 max-w-md text-sm text-ink-muted">{children}</p> : null}
      {action}
    </div>
  );
}
