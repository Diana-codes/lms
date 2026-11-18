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
    title: { default: `${name} · Loan management`, template: `%s · ${name}` },
    description: 'Bridge to Finance loan management system.',
    robots: { index: false, follow: false },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const company = await getCompany();
  return {
    themeColor: company?.brandColor ?? '#173C2E',
    width: 'device-width',
    initialScale: 1,
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const company = await getCompany();
  return (
    <html lang="en" style={brandStyle(company)}>
      {/* Browser extensions (password managers, translators) add attributes to <body>
          before React loads; don't report that as a hydration mismatch. */}
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
