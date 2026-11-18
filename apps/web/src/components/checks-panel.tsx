'use client';

import { AiPanel, Money } from '@kora/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface IdentityCheckView {
  status: 'CHECKED' | 'UNREADABLE' | 'SKIPPED';
  nameOnId: string | null;
  idLast3: string | null;
  dateOfBirth: string | null;
  nameMatch: 'MATCH' | 'PARTIAL' | 'MISMATCH' | 'UNKNOWN';
  idNumberMatch: boolean | null;
  flags: Array<{ code: string; severity: 'HIGH' | 'MEDIUM'; message: string }>;
  modelVersion: string | null;
  error: string | null;
  checkedAt: string;
}

export interface ChecksView {
  identity: IdentityCheckView | null;
  statements: {
    status: string;
    automatic: boolean;
    averageIncome: string | null;
    confirmed: boolean;
    statedIncome: string | null;
    holders: string[];
    unreadable: number;
    error: string | null;
    flags: Array<{ code: string; severity: string; message: string }>;
  } | null;
}

const NAME: Record<IdentityCheckView['nameMatch'], string> = {
  MATCH: 'matches',
  PARTIAL: 'only partly matches',
  MISMATCH: 'does not match',
  UNKNOWN: 'could not be compared with',
};

function Line({ tone, children }: { tone: 'ok' | 'warn' | 'bad'; children: React.ReactNode }) {
  const mark = tone === 'ok' ? '✓' : tone === 'warn' ? '!' : '✕';
  const colour =
    tone === 'ok' ? 'text-positive-fg' : tone === 'warn' ? 'text-caution-fg' : 'text-danger-fg';
  return (
    <li className="flex gap-2 text-sm">
      <span aria-hidden="true" className={`w-3 shrink-0 font-semibold ${colour}`}>
        {mark}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** The ID check alone, for the borrower profile. */
export function IdentityCheckLines({ check }: { check: IdentityCheckView | null }) {
  if (!check) return <Line tone="warn">No ID photo has been checked yet.</Line>;
  if (check.status !== 'CHECKED')
    return <Line tone="warn">{check.error ?? 'The ID photo could not be read.'}</Line>;
  return (
    <>
      <Line tone={check.nameMatch === 'MATCH' ? 'ok' : check.nameMatch === 'PARTIAL' ? 'warn' : 'bad'}>
        Name on the ID, <strong>{check.nameOnId ?? 'unreadable'}</strong>, {NAME[check.nameMatch]}{' '}
        the name given.
      </Line>
      <Line tone={check.idNumberMatch === false ? 'bad' : check.idNumberMatch ? 'ok' : 'warn'}>
        {check.idNumberMatch === false
          ? `The ID number on the card (…${check.idLast3 ?? ''}) is not the one given.`
          : check.idNumberMatch
            ? `The ID number on the card (…${check.idLast3 ?? ''}) is the one given.`
            : 'The ID number could not be compared (none given, or unreadable).'}
      </Line>
      {check.flags
        .filter((f) => f.code !== 'NAME_MISMATCH' && f.code !== 'NAME_PARTIAL' && f.code !== 'ID_NUMBER_MISMATCH')
        .map((f) => (
          <Line key={f.code} tone={f.severity === 'HIGH' ? 'bad' : 'warn'}>
            {f.message}
          </Line>
        ))}
    </>
  );
}

/**
 * What the system found in the borrower's own documents: their ID read and
 * compared, their statements analysed. Advice only; staff decide.
 */
export function ChecksPanel({ code }: { code: string }) {
  const [data, setData] = useState<ChecksView | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setData(undefined);
    const load = () =>
      api<ChecksView | null>(`/applications/${code}/checks`)
        .then((d) => live && setData(d))
        .catch(() => live && setData(null));
    void load();
    // The checks run just after the borrower applies; look again shortly.
    const t = setTimeout(load, 8000);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [code]);

  if (data === undefined) return null;
  const s = data?.statements;
  return (
    <AiPanel title="Automatic checks" meta="advice only" className="gap-2 rounded-panel p-4">
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        <IdentityCheckLines check={data?.identity ?? null} />
        {!s ? (
          <Line tone="warn">No statements analysed yet.</Line>
        ) : s.status === 'FAILED' || s.status === 'PROCESSING' ? (
          <Line tone="warn">
            {s.status === 'PROCESSING'
              ? 'Statements are being read…'
              : (s.error ?? 'The statements could not be read. Check them by eye.')}
          </Line>
        ) : (
          <>
            <Line tone="ok">
              Statements show about{' '}
              <strong>
                <Money amount={s.averageIncome ?? '0'} />
              </strong>{' '}
              a month in income{s.confirmed ? ' (confirmed by an analyst)' : ''}
              {s.statedIncome ? (
                <>
                  ; the borrower said <Money amount={s.statedIncome} />
                </>
              ) : null}
              .
            </Line>
            {s.holders.length ? (
              <Line tone="ok">Account holder on the statements: {s.holders.join(', ')}.</Line>
            ) : null}
            {s.unreadable ? (
              <Line tone="warn">
                {s.unreadable} {s.unreadable === 1 ? 'document' : 'documents'} could not be read.
              </Line>
            ) : null}
            {s.flags.slice(0, 4).map((f) => (
              <Line key={f.code} tone={f.severity === 'HIGH' ? 'bad' : 'warn'}>
                {f.message}
              </Line>
            ))}
          </>
        )}
      </ul>
      <Link href={`/applications/${code}/cashflow`} className="text-xs font-semibold text-ai">
        Open the cash-flow analysis
      </Link>
    </AiPanel>
  );
}
