import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { SparkleIcon } from './icons';

/**
 * Everything an AI produced is shown in purple with the sparkle, so staff can
 * always tell a suggestion from a fact (BUILD_BRIEF §2 and §4.6).
 */
export function AiBadge({
  children = 'AI',
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-pill bg-ai-tint px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-ai',
        className,
      )}
    >
      <SparkleIcon size={12} />
      {children}
    </span>
  );
}

export interface AiPanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  /** Small text on the right of the title, e.g. "Updated today". */
  meta?: ReactNode;
}

/** A purple panel for an AI summary or recommendation. Advisory, never a decision. */
export function AiPanel({ title, meta, className, children, ...rest }: AiPanelProps) {
  return (
    <section
      className={cx(
        'flex flex-col gap-3 rounded-card border border-ai-line bg-ai-tint p-6 text-ink',
        className,
      )}
      {...rest}
    >
      <div className="flex items-center gap-2 text-ai">
        <SparkleIcon size={18} />
        <h2 className="m-0 mr-auto font-display text-lg font-semibold">{title}</h2>
        {meta ? <span className="text-xs">{meta}</span> : null}
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
    </section>
  );
}

/** A reason behind an AI output: "Why: 24 on-time payments". */
export function AiReason({
  kind = 'why',
  children,
}: {
  kind?: 'why' | 'watch';
  children: ReactNode;
}) {
  return (
    <span className="inline-block rounded-pill border border-ai-line bg-surface px-2.5 py-1 text-xs font-medium text-ai">
      {kind === 'why' ? 'Why: ' : 'Watch: '}
      {children}
    </span>
  );
}
