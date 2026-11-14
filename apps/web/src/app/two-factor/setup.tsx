'use client';

import { Button } from '@kora/ui';
import { useState } from 'react';
import { TwoFactorSetup } from '@/components/two-factor-setup';
import { api } from '@/lib/api';

export function StaffTwoFactorSetup({ appIssuer }: { appIssuer: string }) {
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
      <TwoFactorSetup
        base="/auth"
        appIssuer={appIssuer}
        onDone={() => window.location.assign('/')}
      />
      <Button variant="ghost" className="self-start" onClick={signOut} loading={leaving}>
        Sign out
      </Button>
    </>
  );
}
