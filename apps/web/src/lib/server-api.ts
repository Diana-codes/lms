import { cookies, headers } from 'next/headers';
import { API_URL, companyHeaders } from './config';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number };

/**
 * Call the API from a server component, as the signed-in user. The user's
 * session cookies are forwarded, along with the company named by the address
 * the console was opened at. Nothing is cached, because every response is
 * specific to that user and that moment.
 */
export async function serverApi<T>(path: string): Promise<ApiResult<T>> {
  const cookieHeader = (await cookies()).toString();
  const host = (await headers()).get('host');
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { cookie: cookieHeader, accept: 'application/json', ...companyHeaders(host) },
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    // The API is down or unreachable.
    return { ok: false, status: 503 };
  }
}
