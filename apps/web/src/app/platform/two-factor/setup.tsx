'use client';

import { Button, Card } from '@kora/ui';
import { TwoFactorSetup } from '@/components/two-factor-setup';
import { api } from '@/lib/api';
import { PRODUCT_NAME } from '@/lib/config';

export function PlatformTwoFactorSetup() {
  async function signOut() {
    await api('/platform/auth/logout', { method: 'POST', retryOnUnauthorized: false }).catch(
      () => undefined,
    );
    window.location.assign('/platform/login');
  }

  return (
    <Card className="gap-5">
      <TwoFactorSetup
        base="/platform/auth"
        appIssuer={`${PRODUCT_NAME} platform`}
        onDone={() => window.location.assign('/platform')}
      />
      <Button variant="ghost" className="self-start" onClick={signOut}>
        Sign out
      </Button>
    </Card>
  );
}
