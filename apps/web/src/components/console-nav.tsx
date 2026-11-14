'use client';

import { STAFF_ROLE_LABELS } from '@kora/core';
import {
  ApplicationsIcon,
  Avatar,
  BorrowersIcon,
  CollectionsIcon,
  KitIcon,
  LoansIcon,
  OverviewIcon,
  ReportsIcon,
  ShieldIcon,
  Sidebar,
  type SidebarItem,
  SignOutIcon,
  StaffIcon,
} from '@kora/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { Me } from '@/lib/types';

const NAV = [
  { href: '/', label: 'Overview', icon: <OverviewIcon /> },
  { href: '/applications', label: 'Applications', icon: <ApplicationsIcon /> },
  { href: '/loans', label: 'Loans', icon: <LoansIcon /> },
  { href: '/borrowers', label: 'Borrowers', icon: <BorrowersIcon /> },
  { href: '/collections', label: 'Collections', icon: <CollectionsIcon /> },
  { href: '/reports', label: 'Reports', icon: <ReportsIcon /> },
];

const footerLink =
  'flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-nav border-0 bg-transparent px-3 text-left text-sm text-forest-fg no-underline hover:bg-white/10 hover:text-white aria-[current=page]:bg-white/15 aria-[current=page]:text-white';

export function ConsoleNav({
  me,
  openApplications,
  brand,
}: {
  me: Me;
  openApplications: number | null;
  /** The lender's name, shown at the top of the sidebar. */
  brand: string;
}) {
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const items: SidebarItem[] = NAV.map((item) => ({
    ...item,
    active: isActive(item.href),
    badge: item.href === '/applications' && openApplications ? openApplications : undefined,
  }));
  const name = `${me.firstName} ${me.lastName}`;

  async function signOut() {
    setLeaving(true);
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Already signed out, or offline. Either way, leave the console.
    }
    window.location.assign('/login');
  }

  return (
    <Sidebar
      brand={brand}
      items={items}
      LinkComponent={Link}
      footer={
        <>
          <div className="flex flex-col gap-1">
            <Link
              href="/kit"
              className={footerLink}
              aria-current={isActive('/kit') ? 'page' : undefined}
            >
              <KitIcon />
              UI kit
            </Link>
            {me.role === 'ADMIN' || me.role === 'MANAGER' ? (
              <Link
                href="/settings/staff"
                className={footerLink}
                aria-current={isActive('/settings/staff') ? 'page' : undefined}
              >
                <StaffIcon />
                Staff
              </Link>
            ) : null}
            <Link
              href="/settings/security"
              className={footerLink}
              aria-current={isActive('/settings/security') ? 'page' : undefined}
            >
              <ShieldIcon />
              Security
            </Link>
            <button type="button" className={footerLink} onClick={signOut} disabled={leaving}>
              <SignOutIcon />
              {leaving ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
          <div className="flex items-center gap-3 rounded-panel bg-white/10 p-3">
            <Avatar name={name} className="bg-lime" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-white">{name}</span>
              <span className="truncate text-xs text-forest-muted">
                {STAFF_ROLE_LABELS[me.role]}
              </span>
            </div>
          </div>
        </>
      }
    />
  );
}
