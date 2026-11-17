import Link from 'next/link';
import type { Dictionary } from '@/dictionaries/en';
import type { Locale } from '@/lib/i18n';
import { site } from '@/config/site';
import { Logo } from '@/components/Logo';
import { IconArrowUpRight, IconSprout } from '@/components/icons';
import { LanguageSwitch } from './LanguageSwitch';

export function Footer({ dict, lang }: { dict: Dictionary; lang: Locale }) {
  const f = dict.footer;
  const s = dict.services.items;
  const year = 2026; // TODO(BF): derive from build date if preferred

  const columns = [
    {
      title: f.services,
      links: [
        { href: '#services', label: s.loans.title },
        { href: '#services', label: s.advisory.title },
        { href: '#services', label: s.funds.title },
        { href: '#services', label: s.factoring.title },
      ],
    },
    {
      title: f.company,
      links: [
        { href: '#about', label: dict.nav.about },
        { href: '#products', label: dict.nav.products },
        { href: '#contact', label: dict.nav.contact },
        { href: `/${lang}/login`, label: dict.nav.login },
      ],
    },
    {
      // TODO(BF): create these pages (PRD §15.2 privacy notice, complaints procedure)
      title: f.legal,
      links: [
        { href: '#', label: f.privacy },
        { href: '#', label: f.terms },
        { href: '#', label: f.complaints },
      ],
    },
  ];

  const linkClass =
    'inline-flex items-center gap-1 transition duration-300 hover:translate-x-1 hover:text-mint-300';

  return (
    <footer className="relative isolate mt-24 overflow-hidden rounded-t-[2.5rem] bg-forest-950 text-mint-100/75 sm:mt-32">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-grid-lines text-white/[0.04] mask-fade-b"
      />
      <div
        aria-hidden
        className="absolute -right-32 -top-32 -z-10 size-[420px] animate-blob rounded-full bg-green-500/20 blur-3xl"
      />

      <div className="mx-auto max-w-7xl px-4 pt-20 sm:px-6 lg:px-8">
        <div className="grid gap-14 lg:grid-cols-[1.3fr_2fr]">
          <div>
            <Logo onDark />
            <p className="mt-6 max-w-xs text-lg leading-relaxed text-white">{dict.slogans.trust}</p>
            <a
              href="#apply"
              className="group mt-7 inline-flex items-center gap-3 rounded-full bg-mint-300 py-1.5 pl-5 pr-1.5 font-bold text-forest-950 transition duration-300 hover:bg-mint-400"
            >
              {dict.nav.apply}
              <span className="grid size-8 place-items-center rounded-full bg-forest-900 text-mint-300 transition duration-500 ease-spring group-hover:rotate-45">
                <IconArrowUpRight className="size-4" />
              </span>
            </a>
            <div className="mt-8">
              <LanguageSwitch lang={lang} label={dict.nav.language} onDark />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {columns.map((c) => (
              <div key={c.title}>
                <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-mint-300">
                  {c.title}
                </h2>
                <ul className="mt-5 grid gap-3">
                  {c.links.map((l) => (
                    <li key={l.label}>
                      {l.href.startsWith('/') ? (
                        <Link href={l.href} className={linkClass}>
                          {l.label}
                        </Link>
                      ) : (
                        <a href={l.href} className={linkClass}>
                          {l.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-3 border-t border-white/10 pt-8 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            {f.regulated}
            {site.licenceNumber && (
              <>
                {' '}
                {f.licence} {site.licenceNumber}
              </>
            )}
          </p>
          <p>
            © {year} {site.name}. {f.rights}
          </p>
        </div>
      </div>

      <p className="mt-20 flex items-center justify-center gap-3 px-4 text-center text-2xl font-extrabold tracking-[-0.02em] text-mint-300 sm:text-4xl">
        <IconSprout aria-hidden className="size-8 shrink-0 sm:size-10" />
        {dict.slogans.main}
      </p>
      <p
        aria-hidden
        className="mt-6 -mb-[0.12em] select-none whitespace-nowrap text-center text-[clamp(3rem,12.5vw,12.5rem)] font-extrabold leading-[0.8] tracking-[-0.05em] text-transparent [-webkit-text-stroke:1.5px_rgb(162_232_184/0.28)]"
      >
        {site.name}
      </p>
    </footer>
  );
}
