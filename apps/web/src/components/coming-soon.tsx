import { EmptyState } from '@kora/ui';
import type { ReactNode } from 'react';
import { PageHeader } from './page-header';

/** Placeholder for a screen that a later build phase delivers. */
export function ComingSoon({
  title,
  phase,
  icon,
  children,
}: {
  title: string;
  phase: number;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState icon={icon} title={`Built in Phase ${phase}`}>
        {children}
      </EmptyState>
    </>
  );
}
