import { ViewTransition } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDictionary, hasLocale } from '@/lib/i18n';
import { Logo } from '@/components/Logo';
import { BfMark } from '@/components/BfMark';
import { portalUrl, staffLoginUrl } from '@/config/app';

/**
 * Login entry point (PRD §4.2): customers go to the borrower portal, staff to
 * the console sign-in, both in the loan system.
 */
export default async function LoginPage({ params }: PageProps<'/[lang]/login'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = (await getDictionary(lang)).login;

  const options = [
    { title: t.customer, text: t.customerText, href: portalUrl(lang) },
    { title: t.staff, text: t.staffText, href: staffLoginUrl() },
  ];

  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <main className="relative isolate grid min-h-screen place-items-center overflow-hidden px-4 py-16">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-dots text-forest-900/[0.12] mask-fade"
        />
        <div
          aria-hidden
          className="absolute -left-40 top-10 -z-10 size-[480px] animate-blob rounded-full bg-mint-300/45 blur-3xl"
        />
        <BfMark
          aria-hidden
          className="absolute -bottom-20 -right-24 -z-10 w-[560px] text-forest-900/[0.04]"
        />
        <div className="w-full max-w-lg animate-fade-up">
          <Link href={`/${lang}`} aria-label="Bridge to Finance">
            <Logo />
          </Link>
          <h1 className="mt-10 text-5xl font-extrabold tracking-[-0.04em] text-forest-900">
            {t.title}
          </h1>
          <p className="mt-3 text-lg text-ink-500">{t.subtitle}</p>
          <ul className="mt-8 grid gap-3">
            {options.map((o, i) => (
              <li
                key={o.title}
                className="animate-fade-up"
                style={{ animationDelay: `${150 + i * 100}ms` }}
              >
                <a
                  href={o.href}
                  className="group flex items-center justify-between gap-4 rounded-3xl bg-white p-6 ring-1 ring-ink-100 transition hover:ring-mint-400"
                >
                  <div>
                    <h2 className="text-lg font-extrabold text-forest-900">{o.title}</h2>
                    <p className="mt-1 text-sm text-ink-500">{o.text}</p>
                  </div>
                  <span
                    aria-hidden
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-mint-200 text-forest-900 transition group-hover:bg-mint-300"
                  >
                    →
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <Link
            href={`/${lang}`}
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-forest-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-forest-700"
          >
            ← {t.back}
          </Link>
        </div>
      </main>
    </ViewTransition>
  );
}
