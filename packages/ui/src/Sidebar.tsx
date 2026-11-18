import type { ComponentType, ReactNode } from 'react';
import { cx } from './cx';

export interface SidebarItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** A count shown on the right, e.g. open applications. */
  badge?: ReactNode;
  active?: boolean;
}

export interface SidebarLinkProps {
  href: string;
  className?: string;
  'aria-current'?: 'page';
  children: ReactNode;
}

export interface SidebarProps {
  brand?: string;
  /** The lender's logo; the brand's first letter is shown without one. */
  logoUrl?: string | null;
  /** A line under the brand, e.g. "Loan management system". */
  tagline?: string;
  items: SidebarItem[];
  /** Pass the router's link (next/link) so navigation stays client-side. */
  LinkComponent?: ComponentType<SidebarLinkProps> | 'a';
  /** Pinned to the bottom: the lending-limit card, the signed-in user. */
  footer?: ReactNode;
  className?: string;
}

/**
 * The console's forest sidebar. It sits in a wrapping flex row, so on narrow
 * screens it moves to the top of the page instead of squeezing the content.
 */
export function Sidebar({
  brand = 'Bridge to Finance',
  logoUrl,
  tagline,
  items,
  LinkComponent = 'a',
  footer,
  className,
}: SidebarProps) {
  const Link = LinkComponent;
  return (
    <nav
      aria-label="Main"
      className={cx(
        'box-border flex max-w-full flex-[1_1_232px] flex-col gap-7 bg-forest px-4 py-6 text-forest-fg',
        className,
      )}
    >
      <div className="flex items-center gap-2.5 px-2">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="size-8 shrink-0 rounded-[9px] bg-white object-contain p-0.5"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-lime font-display font-bold text-forest"
          >
            {brand.charAt(0)}
          </div>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="font-display text-lg leading-tight font-semibold text-white">
            {brand}
          </span>
          {tagline ? <span className="text-xs text-forest-fg">{tagline}</span> : null}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? 'page' : undefined}
            className={cx(
              'flex min-h-11 items-center gap-3 rounded-nav px-3 text-sm no-underline',
              item.active
                ? 'bg-lime font-semibold text-forest hover:text-forest'
                : 'text-forest-fg hover:bg-white/10 hover:text-white',
            )}
          >
            {item.icon}
            {item.label}
            {item.badge != null ? (
              <span
                className={cx(
                  'ml-auto rounded-pill px-2 py-0.5 text-xs',
                  item.active ? 'bg-forest/15' : 'bg-white/15',
                )}
              >
                {item.badge}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
      {footer ? <div className="mt-auto flex flex-col gap-3">{footer}</div> : null}
    </nav>
  );
}
