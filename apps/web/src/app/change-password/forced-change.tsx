'use client';

import { Button } from '@kora/ui';
import { useState } from 'react';
import { ChangePasswordForm } from '@/components/change-password-form';
import { api } from '@/lib/api';

export function ForcedChange() {
  const [leaving, setLeaving] = useState(false);

  async function signOut() {
    setLeaving(true);
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Already signed out, or offline. Either way, leave.
    }
    window.location.assign('/login');
  }

  return (
    <>
      <ChangePasswordForm
        currentLabel="Temporary password"
        submitLabel="Save and continue"
        onDone={() => window.location.assign('/')}
      />
      <Button variant="ghost" className="self-start" onClick={signOut} loading={leaving}>
        Sign out
      </Button>
    </>
  );
}
