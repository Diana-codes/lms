import 'server-only';
import { cacheLife } from 'next/cache';
import { featuredProducts, type ProductKey } from './products';

/**
 * Where the loan system lives. The website links to its customer app and
 * staff sign-in, and reads the published products from its API.
 */
export const APP_URL = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/** The customer app (the same app as on phones, in the browser): sign up, apply, pay. */
export const portalUrl = (lang: string, product?: string) =>
  `${APP_URL}/app?lang=${lang}${product ? `&product=${encodeURIComponent(product)}` : ''}`;
export const staffLoginUrl = () => `${APP_URL}/login`;

export type Frequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY';

export interface CatalogueProduct {
  code: string;
  name: string;
  kind: string;
  description: string | null;
  minAmount: number;
  maxAmount: number;
  minTermMonths: number;
  maxTermMonths: number;
  frequency: Frequency;
  /** The wording for this product in the site's dictionaries, where there is one. */
  key: ProductKey | null;
  example: { amount: number; termMonths: number; instalment: number; aprBps: number } | null;
}

/** Products the site has its own wording for (both languages). */
const KEY_BY_CODE: Record<string, ProductKey> = {
  SALARY: 'salary',
  'SME-WC': 'business',
  'GRP-01': 'group',
  ASSET: 'asset',
  'EMG-01': 'emergency',
  PERSONAL: 'personal',
  AGRI: 'agri',
};

interface ApiProduct {
  code: string;
  name: string;
  kind: string;
  description: string | null;
  minAmount: string;
  maxAmount: string;
  minTermMonths: number;
  maxTermMonths: number;
  frequency: Frequency;
  example: { amount: string; termMonths: number; instalment: string; aprBps: number } | null;
}

/**
 * The products Bridge to Finance has published in the loan system, refreshed
 * every few minutes. If the system can't be reached, the site shows its own
 * indicative list instead of an empty section.
 */
export async function catalogue(): Promise<{ products: CatalogueProduct[]; live: boolean }> {
  'use cache';
  cacheLife('minutes');
  try {
    const res = await fetch(`${API_URL}/products/catalogue`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`catalogue: ${res.status}`);
    const rows = (await res.json()) as ApiProduct[];
    if (!rows.length) throw new Error('catalogue: empty');
    return {
      live: true,
      products: rows.map((p) => ({
        code: p.code,
        name: p.name,
        kind: p.kind,
        description: p.description,
        minAmount: Number(p.minAmount),
        maxAmount: Number(p.maxAmount),
        minTermMonths: p.minTermMonths,
        maxTermMonths: p.maxTermMonths,
        frequency: p.frequency,
        key: KEY_BY_CODE[p.code] ?? null,
        example: p.example
          ? {
              amount: Number(p.example.amount),
              termMonths: p.example.termMonths,
              instalment: Number(p.example.instalment),
              aprBps: p.example.aprBps,
            }
          : null,
      })),
    };
  } catch {
    return {
      live: false,
      products: featuredProducts.map((p) => ({
        code: Object.entries(KEY_BY_CODE).find(([, k]) => k === p.key)?.[0] ?? p.key,
        name: '',
        kind: '',
        description: null,
        minAmount: p.minAmount,
        maxAmount: p.maxAmount ?? p.minAmount,
        minTermMonths: p.minTermMonths,
        maxTermMonths: p.maxTermMonths,
        frequency: p.key === 'group' ? 'WEEKLY' : 'MONTHLY',
        key: p.key,
        example: null,
      })),
    };
  }
}
