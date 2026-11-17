'use client';

import type { PointerEvent, ReactNode } from 'react';

/** Feeds the pointer position to every `[data-spotlight]` child as `--x` / `--y`. */
export function Spotlight({ children, className }: { children: ReactNode; className?: string }) {
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.querySelectorAll<HTMLElement>('[data-spotlight]').forEach((el) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--x', `${e.clientX - r.left}px`);
      el.style.setProperty('--y', `${e.clientY - r.top}px`);
    });
  };

  return (
    <div className={className} onPointerMove={onMove}>
      {children}
    </div>
  );
}
