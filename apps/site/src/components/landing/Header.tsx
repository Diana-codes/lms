import Link from 'next/link';
import type { Dictionary } from '@/dictionaries/en';
import type { Locale } from '@/lib/i18n';
import { Logo } from '@/components/Logo';
import { IconArrowUpRight } from '@/components/icons';
import { LanguageSwitch } from './LanguageSwitch';
import { MobileMenu } from './MobileMenu';

export function Header({ dict, lang }: { dict: Dictionary; lang: Locale }) {
  const links = [
    { href: '#top', label: dict.nav.home },
    { href: '#about', label: dict.nav.about },
    { href: '#services', label: dict.nav.services },
    { href: '#products', label: dict.nav.products },
    { href: '#contact', label: dict.nav.contact },
  ];

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5">
      <div
        aria-hidden
        className="scroll-progress absolute inset-x-0 top-0 h-[3px] scale-x-0 bg-gradient-to-r from-green-500 via-mint-400 to-green-600"
      />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-forest-900 focus:px-4 focus:py-2 focus:text-white"
      >
        {dict.nav.skip}
      </a>
      <div className="relative isolate mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 rounded-full pl-5 pr-2.5">
        <span
          aria-hidden
          className="header-shell absolute inset-0 -z-10 rounded-full bg-white/70 ring-1 ring-forest-900/[0.06] backdrop-blur-xl"
        />
        <Link
          href={`/${lang}`}
          aria-label="Bridge to Finance"
          className="transition hover:opacity-80"
        >
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-0.5">
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-700 transition duration-300 hover:bg-mint-100 hover:text-forest-900"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <LanguageSwitch lang={lang} label={dict.nav.language} />
          <Link
            href={`/${lang}/login`}
            className="rounded-full px-4 py-2 text-sm font-semibold text-forest-900 transition hover:bg-ink-50"
          >
            {dict.nav.login}
          </Link>
          <a
            href="#apply"
            className="group inline-flex items-center gap-2 rounded-full bg-mint-300 py-1.5 pl-4 pr-1.5 text-sm font-bold text-forest-950 transition duration-300 hover:bg-mint-400"
          >
            {dict.nav.apply}
            <span className="grid size-7 place-items-center rounded-full bg-forest-900 text-mint-300 transition duration-500 ease-spring group-hover:rotate-45">
              <IconArrowUpRight className="size-3.5" />
            </span>
          </a>
        </div>

        <MobileMenu
          links={links}
          lang={lang}
          labels={{
            open: dict.nav.menu,
            close: dict.nav.close,
            login: dict.nav.login,
            apply: dict.nav.apply,
            language: dict.nav.language,
          }}
        />
      </div>
    </header>
  );
}
