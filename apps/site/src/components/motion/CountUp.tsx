'use client';

import { useEffect, useRef } from 'react';

const format = (n: number) => new Intl.NumberFormat('en-US').format(n);

/** Counts up to `value` when scrolled into view. Renders the final value on the server. */
export function CountUp({
  value,
  prefix = '',
  suffix = '',
  duration = 1800,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || value === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const render = (n: number) => {
      el.textContent = `${prefix}${format(n)}${suffix}`;
    };
    let frame = 0;
    render(0);

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min((now - start) / duration, 1);
          render(Math.round(value * (1 - Math.pow(2, -10 * t))));
          if (t < 1) frame = requestAnimationFrame(tick);
          else render(value);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      render(value);
    };
  }, [value, prefix, suffix, duration]);

  return (
    <>
      <span ref={ref} aria-hidden>
        {prefix}
        {format(value)}
        {suffix}
      </span>
      <span className="sr-only">
        {prefix}
        {format(value)}
        {suffix}
      </span>
    </>
  );
}
