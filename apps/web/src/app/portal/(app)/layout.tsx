import { PortalGate } from '../portal-gate';

export default function PortalAppLayout({ children }: { children: React.ReactNode }) {
  return <PortalGate>{children}</PortalGate>;
}
