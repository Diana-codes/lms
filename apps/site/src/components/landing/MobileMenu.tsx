'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IconClose, IconMenu } from '@/components/icons';

type Props = {
  links: { href: string; label: string }[];
  lang: 'en' | 'rw';
  labels: { open: string; close: string; login: string; apply: string; language: string };
};

export function MobileMenu({ links, lang, labels }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-menu"
        className="grid size-11 place-items-center rounded-full bg-forest-900 text-white transition hover:bg-forest-700"
      >
        {open ? <IconClose /> : <IconMenu />}
        <span className="sr-only">{open ? labels.close : labels.open}</span>
      </button>

      {open && (
        <div
          id="mobile-menu"
          className="fixed inset-x-3 top-[5.25rem] bottom-3 z-40 animate-fade-up overflow-y-auto rounded-[2rem] bg-white px-5 pb-8 pt-3 shadow-2xl shadow-forest-950/20 ring-1 ring-ink-100 [animation-duration:500ms]"
        >
          <nav aria-label="Main">
            <ul className="divide-y divide-ink-100">
              {links.map((l, i) => (
                <li
                  key={l.href}
                  className="animate-fade-up"
                  style={{ animationDelay: `${80 + i * 50}ms` }}
                >
                  <a
                    href={l.href}
                    onClick={close}
                    className="flex items-center justify-between py-4 text-2xl font-extrabold tracking-tight text-forest-900"
                  >
                    {l.label}
                    <span aria-hidden className="text-base text-green-500">
                      0{i + 1}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mt-6 grid gap-3">
            <a
              href="#apply"
              onClick={close}
              className="rounded-full bg-mint-300 px-4 py-3.5 text-center font-bold text-forest-950"
            >
              {labels.apply}
            </a>
            <Link
              href={`/${lang}/login`}
              className="rounded-full px-4 py-3.5 text-center font-semibold text-forest-900 ring-1 ring-ink-200"
            >
              {labels.login}
            </Link>
          </div>

          <div className="mt-8 flex items-center justify-between">
            <span className="text-sm text-ink-500">{labels.language}</span>
            <div className="flex gap-2 text-sm font-semibold">
              <Link
                href="/rw"
                lang="rw"
                aria-current={lang === 'rw' ? 'true' : undefined}
                className={`rounded-full px-3 py-1.5 ${lang === 'rw' ? 'bg-forest-900 text-white' : 'bg-ink-50 text-ink-700'}`}
              >
                Kinyarwanda
              </Link>
              <Link
                href="/en"
                lang="en"
                aria-current={lang === 'en' ? 'true' : undefined}
                className={`rounded-full px-3 py-1.5 ${lang === 'en' ? 'bg-forest-900 text-white' : 'bg-ink-50 text-ink-700'}`}
              >
                English
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
