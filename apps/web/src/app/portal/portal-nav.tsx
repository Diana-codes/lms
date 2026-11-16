'use client';

import { cx } from '@kora/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePortalI18n } from '@/lib/portal/i18n';

const LINKS = [
  { href: '/portal/home', label: 'nav.home' },
  { href: '/portal/apply', label: 'nav.apply' },
  { href: '/portal/notifications', label: 'nav.alerts' },
  { href: '/portal/profile', label: 'nav.profile' },
] as const;

export function PortalNav({ unread = 0 }: { unread?: number }) {
  const pathname = usePathname();
  const { t } = usePortalI18n();
  return (
    <nav
      aria-label={t('nav.label')}
      className="sticky bottom-0 grid grid-cols-4 border-t border-line bg-surface"
    >
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cx(
              'relative flex flex-col items-center gap-0.5 px-2 py-3 text-xs font-semibold no-underline',
              active ? 'text-forest' : 'text-ink-muted',
            )}
            aria-current={active ? 'page' : undefined}
          >
            {t(link.label)}
            {link.href === '/portal/notifications' && unread > 0 ? (
              <span className="absolute top-2 right-[28%] size-1.5 rounded-full bg-amber" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
