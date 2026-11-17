'use client';

import { MAX_REJECTION_REASON, REJECTION_REASONS } from '@kora/core';
import {
  ApplicationsIcon,
  Button,
  buttonClasses,
  Card,
  FormError,
  Modal,
  OptionButton,
  Pill,
  TextAreaField,
  useToast,
} from '@kora/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { BorrowerProfile } from '@/lib/types';

type Doc = BorrowerProfile['documents'][number];
const OTHER = 'other';

/**
 * KYC documents on the borrower profile. Officers and managers can open the
 * file (each view is audited), then verify it or ask for a new one with a
 * reason the borrower will read in the app and by SMS.
 */
export function DocumentsCard({
  borrower,
  canReview,
}: {
  borrower: Pick<BorrowerProfile, 'code' | 'firstName' | 'documents'>;
  canReview: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Doc | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reason = choice === OTHER ? custom.trim() : (choice ?? '');
  const base = `/borrowers/${borrower.code}/documents`;

  async function verify(doc: Doc) {
    setBusy(doc.id);
    try {
      await api(`${base}/${doc.id}/verify`, { method: 'POST' });
      toast(`${doc.name} verified for ${borrower.firstName}.`);
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  }

  function openReject(doc: Doc) {
    setRejecting(doc);
    setChoice(null);
    setCustom('');
    setError(null);
  }

  async function reject() {
    if (!rejecting) return;
    setBusy(rejecting.id);
    setError(null);
    try {
      await api(`${base}/${rejecting.id}/reject`, { method: 'POST', body: { reason } });
      toast(`${borrower.firstName} has been asked for a new ${rejecting.name}.`);
      setRejecting(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="gap-3 p-[22px]">
      <h2 className="m-0 font-display text-base font-semibold">KYC documents</h2>
      {borrower.documents.length === 0 ? (
        <p className="m-0 text-sm text-ink-muted">No documents on file yet.</p>
      ) : null}
      <ul className="m-0 flex list-none flex-col p-0" aria-label="KYC documents">
        {borrower.documents.map((doc) => (
          <li key={doc.id} className="flex flex-col gap-2 border-b border-line-soft py-2.5">
            <div className="flex items-center gap-3">
              <span className="flex size-9 flex-none items-center justify-center rounded-nav bg-ground text-forest">
                <ApplicationsIcon size={16} />
              </span>
              <div className="mr-auto flex min-w-0 flex-col">
                <span className="text-sm font-medium">{doc.name}</span>
                <span className="text-xs text-ink-muted">{doc.meta}</span>
              </div>
              <Pill tone={doc.tone}>{doc.status}</Pill>
            </div>
            {doc.reason ? (
              <p className="m-0 rounded-control bg-danger-bg px-3 py-2 text-xs text-danger-fg">
                Asked for a new one: {doc.reason}
              </p>
            ) : null}
            {canReview && (doc.file || doc.reviewable) ? (
              <div className="flex flex-wrap gap-2 pl-12">
                {doc.file ? (
                  <a
                    href={`/api${base}/${doc.id}/file`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonClasses({ variant: 'secondary' })}
                    aria-label={`View ${doc.name} (${doc.file === 'pdf' ? 'PDF' : 'photo'}, opens in a new tab)`}
                  >
                    View {doc.file === 'pdf' ? 'PDF' : 'photo'}
                  </a>
                ) : null}
                {doc.reviewable && doc.file ? (
                  <Button
                    variant="primary"
                    loading={busy === doc.id && !rejecting}
                    onClick={() => verify(doc)}
                    aria-label={`Verify ${doc.name}`}
                  >
                    Verify
                  </Button>
                ) : null}
                {doc.reviewable ? (
                  <Button
                    variant="ghost"
                    className="text-danger-fg"
                    onClick={() => openReject(doc)}
                    aria-label={`Ask for a new ${doc.name}`}
                  >
                    Ask for a new one
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <Modal
        open={rejecting != null}
        onClose={() => setRejecting(null)}
        title={`Ask for a new ${rejecting?.name ?? 'document'}`}
        subtitle={`${borrower.firstName} will see this in the app and get it by SMS.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={reason.length < 5}
              loading={busy != null}
              onClick={reject}
            >
              Send request
            </Button>
          </>
        }
      >
        <div role="group" aria-label="What needs fixing?" className="flex flex-col gap-2">
          {REJECTION_REASONS.map((r) => (
            <OptionButton
              key={r}
              pressed={choice === r}
              onClick={() => setChoice(r)}
              className="items-start! text-left!"
            >
              {r}
            </OptionButton>
          ))}
          <OptionButton
            pressed={choice === OTHER}
            onClick={() => setChoice(OTHER)}
            className="items-start! text-left!"
          >
            Something else
          </OptionButton>
        </div>
        {choice === OTHER ? (
          <TextAreaField
            label="Tell the borrower what to fix"
            value={custom}
            maxLength={MAX_REJECTION_REASON}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Write it as you would say it to them."
          />
        ) : null}
        <FormError>{error}</FormError>
      </Modal>
    </Card>
  );
}
