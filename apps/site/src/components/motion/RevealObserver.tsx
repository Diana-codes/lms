'use client';

import { useEffect } from 'react';

/**
 * Marks every `[data-reveal]` element with `data-visible` once it scrolls into
 * view; the matching transitions live in globals.css. Content stays visible
 * when JavaScript is off, because the hidden state only applies under
 * `@media (scripting: enabled)`.
 */
export function RevealObserver() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute('data-visible', '');
          io.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    document.querySelectorAll('[data-reveal]:not([data-visible])').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return null;
}
