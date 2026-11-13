'use client';

import { Card, CardTitle } from '@kora/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { FairnessRow } from '@/lib/types';

/** Scores by gender and district, from the live scoring rules, to watch for unfair patterns. */
export function Fairness() {
  const [rows, setRows] = useState<FairnessRow[] | null>(null);
  useEffect(() => {
    api<FairnessRow[]>('/ai/fairness')
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  if (!rows) return null;
  const groups = (d: FairnessRow['dimension']) =>
    rows.filter((r) => r.dimension === d && r.borrowers >= 5);
  return (
    <Card className="flex-[1_1_380px]">
      <div className="flex flex-col gap-1">
        <CardTitle>Score fairness check</CardTitle>
        <span className="text-xs text-ink-muted">
          Latest score from the scoring rules (rules-v1) per borrower. Gender and district are never
          inputs; large gaps here are worth a look.
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-ink-muted">
          No borrowers scored by the rules yet. Scores appear as new applications come in.
        </p>
      ) : (
        (['gender', 'district'] as const).map((d) =>
          groups(d).length ? (
            <div key={d} className="overflow-x-auto">
              <table className="w-full min-w-[360px] border-collapse text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-xs text-ink-muted">
                    <th scope="col" className="border-b border-line py-2 font-medium">
                      {d === 'gender' ? 'Gender' : 'District'}
                    </th>
                    <th scope="col" className="border-b border-line py-2 text-right font-medium">
                      Borrowers
                    </th>
                    <th scope="col" className="border-b border-line py-2 text-right font-medium">
                      Average score
                    </th>
                    <th scope="col" className="border-b border-line py-2 text-right font-medium">
                      Recommended to approve
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groups(d).map((r) => (
                    <tr key={r.group}>
                      <td className="border-b border-line-soft py-2 capitalize">
                        {r.group.toLowerCase()}
                      </td>
                      <td className="border-b border-line-soft py-2 text-right">{r.borrowers}</td>
                      <td className="border-b border-line-soft py-2 text-right font-semibold">
                        {r.averageScore}
                      </td>
                      <td className="border-b border-line-soft py-2 text-right">
                        {r.approveShare.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null,
        )
      )}
    </Card>
  );
}
