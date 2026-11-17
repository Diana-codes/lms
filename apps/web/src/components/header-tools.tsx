'use client';

import { BellIcon, SearchInput } from '@kora/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import type { NotificationList, SearchResults } from '@/lib/types';

const DOT: Record<NotificationList['items'][number]['kind'], string> = {
  AI_FLAG: 'bg-ai',
  RISK: 'bg-rust',
  CONTRACT: 'bg-lime-deep',
  PAYMENT: 'bg-lime-deep',
  SYSTEM: 'bg-ink-muted',
  DOCUMENT: 'bg-amber',
};

/** Closes a popover when the user clicks elsewhere or presses Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api<SearchResults>(`/search?q=${encodeURIComponent(text)}`)
        .then((r) => !cancelled && setResults(r))
        .catch(() => !cancelled && setResults({ borrowers: [], loans: [] }));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const empty = results && results.borrowers.length === 0 && results.loans.length === 0;
  const row =
    'flex min-h-11 items-center gap-2 rounded-nav px-2.5 text-sm text-ink no-underline hover:bg-ground';

  return (
    <div ref={ref} className="relative">
      <SearchInput
        label="Search loans and borrowers"
        placeholder="Search loans, borrowers…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && results ? (
        <div className="absolute top-[52px] right-0 left-0 z-40 flex min-w-[280px] flex-col rounded-2xl border border-line bg-surface p-2 shadow-pop">
          {empty ? (
            <p className="m-0 px-2.5 py-3 text-sm text-ink-muted">Nothing matches “{q.trim()}”.</p>
          ) : null}
          {results.borrowers.length ? (
            <span className="px-2.5 pt-1.5 pb-1 text-xs text-ink-muted">Borrowers</span>
          ) : null}
          {results.borrowers.map((b) => (
            <Link
              key={b.code}
              href={`/borrowers/${b.code}`}
              className={row}
              onClick={() => setOpen(false)}
            >
              <span className="font-medium">{b.name}</span>
              <span className="ml-auto text-xs text-ink-muted">{b.code}</span>
            </Link>
          ))}
          {results.loans.length ? (
            <span className="px-2.5 pt-1.5 pb-1 text-xs text-ink-muted">Loans</span>
          ) : null}
          {results.loans.map((l) => (
            <Link
              key={l.code}
              href={`/loans/${l.code}`}
              className={row}
              onClick={() => setOpen(false)}
            >
              <span className="font-medium">{l.code}</span>
              <span className="ml-auto truncate text-xs text-ink-muted">{l.name}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function NotificationBell({ initial, now }: { initial: NotificationList; now: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(initial);
  const ref = useDismiss(open, () => setOpen(false));

  async function markRead() {
    setList((l) => ({ unread: 0, items: l.items.map((i) => ({ ...i, read: true })) }));
    setOpen(false);
    try {
      await api('/notifications/read-all', { method: 'POST' });
      router.refresh();
    } catch {
      setList(initial);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={list.unread ? `Notifications, ${list.unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-11 cursor-pointer items-center justify-center rounded-control border border-line bg-surface hover:bg-ground"
      >
        <BellIcon />
        {list.unread ? (
          <span className="absolute top-[9px] right-2.5 size-2 rounded-full border-2 border-surface bg-rust" />
        ) : null}
      </button>
      {open ? (
        <div
          role="region"
          aria-label="Notifications"
          className="absolute top-[52px] right-0 z-40 flex w-[340px] max-w-[calc(100vw-32px)] flex-col rounded-2xl border border-line bg-surface p-2 shadow-pop"
        >
          <div className="flex items-center px-2.5 py-1">
            <span className="mr-auto text-sm font-semibold">Notifications</span>
            {list.unread ? (
              <button
                type="button"
                onClick={markRead}
                className="min-h-11 cursor-pointer border-0 bg-transparent px-1.5 text-xs font-semibold text-forest"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          {list.items.length === 0 ? (
            <p className="m-0 px-2.5 py-3 text-sm text-ink-muted">Nothing new.</p>
          ) : null}
          {list.items.map((n) => {
            const body = (
              <>
                <span className={`mt-1.5 size-2 flex-none rounded-full ${DOT[n.kind]}`} />
                <span className="flex flex-col gap-0.5 text-[13px]">
                  <span className={n.read ? 'font-medium' : 'font-semibold'}>{n.title}</span>
                  <span className="text-ink-muted">{timeAgo(n.createdAt, now)}</span>
                </span>
              </>
            );
            const cls = 'flex gap-2.5 rounded-nav p-2.5 text-ink no-underline hover:bg-ground';
            return n.href ? (
              <Link key={n.id} href={n.href} className={cls} onClick={() => setOpen(false)}>
                {body}
              </Link>
            ) : (
              <div key={n.id} className={cls}>
                {body}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
