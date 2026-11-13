import type { ReactNode } from 'react';

/** The title block at the top of every console page. */
export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-4">
      <div className="mr-auto flex flex-col gap-1">
        {eyebrow ? <span className="text-[13px] text-ink-muted">{eyebrow}</span> : null}
        <h1 className="m-0 font-display text-[30px] leading-tight font-semibold tracking-[-0.02em]">
          {title}
        </h1>
      </div>
      {children}
    </header>
  );
}
