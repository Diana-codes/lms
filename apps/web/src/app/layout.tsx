import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'Kora Lend', template: '%s · Kora Lend' },
  description: 'Loan management for lenders in Rwanda.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0E3B2E', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
