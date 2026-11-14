'use client';

import { Card, CardTitle, useToast } from '@kora/ui';
import { ChangePasswordForm } from '@/components/change-password-form';

export function PasswordCard() {
  const toast = useToast();
  return (
    <Card className="max-w-2xl">
      <CardTitle>Password</CardTitle>
      <p className="m-0 text-sm text-ink-muted">Changing it signs you out on your other devices.</p>
      <ChangePasswordForm onDone={() => toast('Password changed.')} />
    </Card>
  );
}
