'use client';

import { Button, Modal, TextAreaField, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

/** A free-text SMS to a borrower, from the profile page. */
export function SendSmsButton({
  borrowerCode,
  name,
  phone,
  loanCode,
}: {
  borrowerCode: string;
  name: string;
  phone: string;
  loanCode?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ status: string; failureReason: string | null }>(
        `/borrowers/${borrowerCode}/sms`,
        { method: 'POST', body: { body: text, loanCode } },
      );
      if (r.status === 'FAILED') {
        setError(`Could not send: ${r.failureReason ?? 'not accepted by the SMS provider'}`);
        return;
      }
      toast(`SMS sent to ${name}.`);
      setOpen(false);
      setText('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Message
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Send SMS"
        subtitle={`To ${name} · ${phone}`}
      >
        <TextAreaField
          label="Message"
          rows={4}
          maxLength={480}
          placeholder="Hello…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={error}
          data-autofocus
        />
        <span className="text-xs text-ink-muted">
          {text.length} / 480 characters. Replies are not received yet; ask the borrower to call the
          branch.
        </span>
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!text.trim()} onClick={send}>
            Send SMS
          </Button>
        </div>
      </Modal>
    </>
  );
}
