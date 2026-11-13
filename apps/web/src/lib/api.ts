/**
 * Browser-side API client. Requests go to /api/* on this origin and are
 * forwarded to the API by Next (see next.config.ts), so the httpOnly session
 * cookies travel with them and are never readable from script.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time, shared by every request that hit a 401. */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
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
  if (res.status >= 500) return 'Something went wrong on our side. Try again in a moment.';
  return `Request failed (${res.status})`;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Set false for sign-in calls, where a 401 is an answer, not an expired session. */
  retryOnUnauthorized?: boolean;
}

export async function api<T = void>(path: string, opts: ApiOptions = {}): Promise<T> {
  const send = () =>
    fetch(`/api${path}`, {
      method: opts.method ?? 'GET',
      headers: opts.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && opts.retryOnUnauthorized !== false && (await refreshSession())) {
      res = await send();
    }
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }

  if (!res.ok) throw new ApiError(res.status, await messageOf(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
