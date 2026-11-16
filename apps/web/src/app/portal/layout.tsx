import type { Metadata } from 'next';
import { brandStyle, getCompany, PRODUCT_NAME } from '@/lib/company';
import { PortalLanguageProvider, T } from '@/lib/portal/i18n';

export const metadata: Metadata = { title: { default: 'Borrower', template: '%s · Borrower' } };

export default async function PortalRootLayout({ children }: { children: React.ReactNode }) {
  const company = await getCompany();
  const name = company?.displayName ?? PRODUCT_NAME;

  return (
    <PortalLanguageProvider lender={name}>
      <div className="min-h-screen bg-ground text-ink" style={brandStyle(company)}>
        <a
          href="#portal-main"
          className="sr-only focus:not-sr-only focus:absolute focus:m-3 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
        >
          <T k="common.skipToContent" />
        </a>
        <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col">
          <header className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-3">
            {company?.logoUrl ? (
              <img src={company.logoUrl} alt="" className="size-8 rounded-[9px] object-contain" />
            ) : (
              <div
                aria-hidden="true"
                className="flex size-8 items-center justify-center rounded-[9px] bg-forest font-display text-sm font-bold text-lime"
              >
                {name.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <p className="m-0 truncate font-display text-base font-semibold leading-tight">
                {name}
              </p>
              <p className="m-0 text-xs text-ink-muted">
                <T k="portal.subtitle" />
              </p>
            </div>
          </header>
          <div id="portal-main" className="flex flex-1 flex-col">
            {children}
          </div>
        </div>
      </div>
    </PortalLanguageProvider>
  );
}
