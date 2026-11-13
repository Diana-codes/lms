'use client';

import { Button, FormError, TextAreaField, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';

export function NoteForm({ code }: { code: string }) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) {
      setError('Write something first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/borrowers/${code}/notes`, { method: 'POST', body: { body: draft } });
      setDraft('');
      toast('Note saved.');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3" noValidate>
      <TextAreaField
        label="Add a note"
        hideLabel
        placeholder="Add a note…"
        maxLength={2000}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
      />
      <FormError>{error}</FormError>
      <Button type="submit" className="self-end" loading={busy}>
        Save note
      </Button>
    </form>
  );
}
