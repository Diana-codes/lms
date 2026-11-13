'use client';

import { Button, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

/** Ask the AI to write, or rewrite, the borrower summary from current facts. */
export function AiSummaryButton({ code, hasSummary }: { code: string; hasSummary: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function write() {
    setBusy(true);
    try {
      await api(`/ai/borrowers/${code}/summary`, { method: 'POST', body: { force: true } });
      toast('AI summary updated.');
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={write}
      className="h-9 self-start border-ai-edge text-[13px] text-ai-ink"
    >
      {hasSummary ? 'Refresh AI summary' : 'Write AI summary'}
    </Button>
  );
}
