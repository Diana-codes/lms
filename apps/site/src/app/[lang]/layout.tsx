import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { notFound } from 'next/navigation';
import { getDictionary, hasLocale, locales } from '@/lib/i18n';
import '../globals.css';

// Self-hosted so builds and pages don't depend on Google Fonts (SIL Open Font License).
const jakarta = localFont({
  src: '../fonts/PlusJakartaSans-Variable.woff2',
  variable: '--font-jakarta',
  weight: '200 800',
  display: 'swap',
});

export async function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: LayoutProps<'/[lang]'>): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.meta.title,
    description: dict.meta.description,
    alternates: { languages: { en: '/en', rw: '/rw' } },
  };
}

export default async function RootLayout({ children, params }: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  return (
    <html lang={lang} className={`${jakarta.variable} antialiased`}>
      <body className="min-h-screen bg-cream font-sans text-ink-900">{children}</body>
    </html>
  );
}
