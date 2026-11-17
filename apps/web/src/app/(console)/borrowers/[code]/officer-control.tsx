'use client';

import { Button, FormError, Modal, SelectField, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Me } from '@/lib/types';

interface StaffMember {
  id: string;
  firstName: string;
  lastName: string;
  role: Me['role'];
  branch: string | null;
  isActive: boolean;
}

/**
 * Give the customer a relationship officer. An officer can take a customer
 * who has none (often someone who signed up in the app); a manager can assign
 * or move anyone. Open applications move with the customer.
 */
export function OfficerControl({
  code,
  officerId,
  me,
}: {
  code: string;
  officerId: string | null;
  me: Me;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isManager = me.role === 'MANAGER' || me.role === 'ADMIN';
  const canTake = !officerId && (me.role === 'LOAN_OFFICER' || me.role === 'MANAGER');
  if (!canTake && !isManager) return null;

  async function assign(id?: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ officerName: string }>(`/borrowers/${code}/officer`, {
        method: 'POST',
        body: id ? { officerId: id } : {},
      });
      toast(`${r.officerName} is now the relationship officer.`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function openPicker() {
    setOpen(true);
    setError(null);
    setChoice('');
    if (staff) return;
    try {
      const all = await api<StaffMember[]>('/users');
      setStaff(
        all.filter((u) => u.isActive && (u.role === 'LOAN_OFFICER' || u.role === 'MANAGER')),
      );
    } catch {
      setError('Could not load the staff list. Try again.');
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canTake ? (
        <Button loading={busy && !open} onClick={() => assign()}>
          Take this customer
        </Button>
      ) : null}
      {isManager ? (
        <Button variant="secondary" onClick={openPicker}>
          {officerId ? 'Change officer' : 'Assign an officer'}
        </Button>
      ) : null}
      {!open ? <FormError>{error}</FormError> : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Relationship officer"
        subtitle="Open applications move to the new officer. Recorded in the audit log."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} disabled={!choice} onClick={() => assign(choice)}>
              Assign
            </Button>
          </>
        }
      >
        <SelectField
          label="Officer"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          disabled={!staff}
        >
          <option value="">{staff ? 'Choose someone' : 'Loading…'}</option>
          {staff?.map((u) => (
            <option key={u.id} value={u.id} disabled={u.id === officerId}>
              {u.firstName} {u.lastName}
              {u.role === 'MANAGER' ? ' (manager)' : ''}
              {u.branch ? ` · ${u.branch}` : ''}
            </option>
          ))}
        </SelectField>
        <FormError>{error}</FormError>
      </Modal>
    </div>
  );
}
