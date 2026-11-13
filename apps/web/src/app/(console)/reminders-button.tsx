'use client';

import { Button, useToast } from '@kora/ui';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

export function RemindersButton({ dueCount }: { dueCount: number }) {
  const toast = useToast();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');

  async function send() {
    setState('busy');
    try {
      const r = await api<{ sent: number; failed: number; alreadyReminded: number }>(
        '/sms/reminders',
        { method: 'POST', body: { days: 7 } },
      );
      setState('done');
      toast(
        r.sent === 0
          ? r.alreadyReminded > 0
            ? 'Everyone due this week was already reminded in the last 3 days.'
            : 'Nobody is due this week.'
          : `Reminder SMS sent to ${r.sent} ${r.sent === 1 ? 'borrower' : 'borrowers'} due this week${r.failed ? ` (${r.failed} could not be reached)` : ''}.`,
      );
    } catch (err) {
      setState('idle');
      toast(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <Button
      variant="secondary"
      block
      loading={state === 'busy'}
      disabled={state === 'done' || dueCount === 0}
      onClick={send}
    >
      {state === 'done' ? 'Reminders sent' : 'Send SMS reminders'}
    </Button>
  );
}
