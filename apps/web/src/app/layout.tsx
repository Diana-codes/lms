import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { brandStyle, getCompany, PRODUCT_NAME } from '@/lib/company';
import { Providers } from './providers';

export async function generateMetadata(): Promise<Metadata> {
  const company = await getCompany();
  const name = company?.displayName ?? PRODUCT_NAME;
  return {
    title: { default: name, template: `%s · ${name}` },
    description: 'Loan management for lenders in Rwanda.',
    robots: { index: false, follow: false },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const company = await getCompany();
  return {
    themeColor: company?.brandColor ?? '#0E3B2E',
    width: 'device-width',
    initialScale: 1,
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const company = await getCompany();
  return (
    <html lang="en" style={brandStyle(company)}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
