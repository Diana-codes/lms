import { headers } from 'next/headers';
import { cache, type CSSProperties } from 'react';
import { isPlatformHost } from './config';
import { serverApi } from './server-api';

/** The lending company this console is for (from its address), as the API describes it. */
export interface CompanyProfile {
  slug: string;
  name: string;
  displayName: string;
  brandColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  defaultLanguage: 'EN' | 'RW' | 'FR';
  features: { ai: boolean; autoApprove: boolean };
}

export { PRODUCT_NAME } from './config';

/** Once per request: the company named by the address the console was opened at. */
export const getCompany = cache(async (): Promise<CompanyProfile | null> => {
  // The platform console belongs to no company.
  if (isPlatformHost((await headers()).get('host'))) return null;
  const res = await serverApi<CompanyProfile>('/company');
  return res.ok ? res.data : null;
});

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The company's colours, as overrides of the theme's CSS variables. The
 * console's components all read these variables, so nothing else changes.
 */
export function brandStyle(company: CompanyProfile | null): CSSProperties | undefined {
  if (!company) return undefined;
  const vars: Record<string, string> = {};
  if (company.brandColor && HEX.test(company.brandColor)) {
    vars['--color-forest'] = company.brandColor;
    vars['--color-forest-deep'] = `color-mix(in oklab, ${company.brandColor} 70%, black)`;
  }
  if (company.accentColor && HEX.test(company.accentColor)) {
    vars['--color-lime'] = company.accentColor;
    vars['--color-lime-deep'] = `color-mix(in oklab, ${company.accentColor} 85%, black)`;
  }
  return Object.keys(vars).length ? (vars as CSSProperties) : undefined;
}
