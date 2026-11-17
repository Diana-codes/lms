import Link from 'next/link';
import type { Locale } from '@/lib/i18n';

const options: { code: Locale; short: string; name: string }[] = [
  { code: 'rw', short: 'RW', name: 'Kinyarwanda' },
  { code: 'en', short: 'EN', name: 'English' },
];

export function LanguageSwitch({
  lang,
  label,
  onDark = false,
}: {
  lang: Locale;
  label: string;
  onDark?: boolean;
}) {
  return (
    <nav aria-label={label}>
      <ul
        className={`inline-flex rounded-full p-0.5 text-xs font-semibold ${onDark ? 'bg-white/10' : 'bg-ink-50'}`}
      >
        {options.map((o) => {
          const active = o.code === lang;
          return (
            <li key={o.code}>
              <Link
                href={`/${o.code}`}
                hrefLang={o.code}
                lang={o.code}
                aria-current={active ? 'true' : undefined}
                title={o.name}
                className={`block rounded-full px-2.5 py-1.5 transition ${
                  active
                    ? onDark
                      ? 'bg-white text-green-800'
                      : 'bg-white text-ink-900 shadow-sm'
                    : onDark
                      ? 'text-green-100 hover:text-white'
                      : 'text-ink-500 hover:text-ink-900'
                }`}
              >
                <span aria-hidden>{o.short}</span>
                <span className="sr-only">{o.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
