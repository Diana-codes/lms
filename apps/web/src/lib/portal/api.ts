/**
 * Borrower portal API client. Tokens live in sessionStorage so closing the
 * tab signs the borrower out. Calls go through /api → the Nest API.
 */

const ACCESS = 'kl_borrower_access';
const REFRESH = 'kl_borrower_refresh';

export class PortalApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface PortalTokens {
  accessToken: string;
  refreshToken: string;
}

function store(): Storage | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage;
}

export function savePortalTokens(t: PortalTokens): void {
  const s = store();
  if (!s) return;
  s.setItem(ACCESS, t.accessToken);
  s.setItem(REFRESH, t.refreshToken);
}

export function clearPortalTokens(): void {
  const s = store();
  if (!s) return;
  s.removeItem(ACCESS);
  s.removeItem(REFRESH);
}

export function hasPortalSession(): boolean {
  return !!store()?.getItem(REFRESH);
}

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const token = store()?.getItem(REFRESH);
    if (!token) return false;
    try {
      const res = await fetch('/api/app/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
      });
      if (!res.ok) {
        clearPortalTokens();
        return false;
      }
      savePortalTokens((await res.json()) as PortalTokens);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function messageOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join('. ');
    if (body.message) return body.message;
  } catch {
    // not JSON
  }
  return res.status >= 500
    ? 'Something went wrong on our side. Try again in a moment.'
    : `Request failed (${res.status})`;
}

export interface PortalApiOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  form?: FormData;
  auth?: boolean;
}

export async function portalApi<T = void>(
  path: string,
  opts: PortalApiOptions = {},
): Promise<T> {
  const send = async () => {
    const headers: Record<string, string> = {};
    if (opts.auth !== false) {
      const token = store()?.getItem(ACCESS);
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    return fetch(`/api${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    });
  };

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && opts.auth !== false && (await refresh())) res = await send();
  } catch {
    throw new PortalApiError(0, 'Could not reach the server. Check your connection and try again.');
  }
  if (!res.ok) throw new PortalApiError(res.status, await messageOf(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const portalErrorMessage = (err: unknown) =>
  err instanceof PortalApiError ? err.message : 'Something went wrong. Try again.';
