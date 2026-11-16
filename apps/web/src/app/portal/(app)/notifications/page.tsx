'use client';

import { Button } from '@kora/ui';
import { useEffect, useState } from 'react';
import { portalApi, portalErrorMessage } from '@/lib/portal/api';
import type { PortalNotification } from '@/lib/portal/types';
import { PortalNav } from '../../portal-nav';

export default function PortalNotificationsPage() {
  const [items, setItems] = useState<PortalNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    portalApi<PortalNotification[]>('/app/notifications')
      .then(setItems)
      .catch((e) => setError(portalErrorMessage(e)));
  }, []);

  return (
    <>
      <main className="flex flex-1 flex-col gap-4 p-5 pb-8">
        <h1 className="m-0 font-display text-xl font-semibold">Alerts</h1>
        {error ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-sm text-ink-muted">{error}</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setError(null);
                portalApi<PortalNotification[]>('/app/notifications')
                  .then(setItems)
                  .catch((e) => setError(portalErrorMessage(e)));
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {items && items.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">No alerts yet.</p>
        ) : null}
        {items && items.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {items.map((n) => (
              <li
                key={n.id}
                className="rounded-xl border border-line bg-surface px-4 py-3 text-sm"
              >
                <div className="font-semibold">{n.title}</div>
                <div className="mt-1 text-xs text-ink-muted">
                  {new Date(n.at).toLocaleString()} · {n.kind.toLowerCase()}
                </div>
              </li>
            ))}
          </ul>
        ) : !error && !items ? (
          <p className="m-0 text-sm text-ink-muted">Loading…</p>
        ) : null}
      </main>
      <PortalNav />
    </>
  );
}
