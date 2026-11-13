import * as SecureStore from 'expo-secure-store';

/**
 * Calls to the API from the phone. Tokens live in the device's secure
 * store (Keystore on Android, Keychain on iOS), never in plain storage.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000';

const ACCESS = 'kl_access';
const REFRESH = 'kl_refresh';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export async function saveTokens(t: Tokens): Promise<void> {
  await SecureStore.setItemAsync(ACCESS, t.accessToken);
  await SecureStore.setItemAsync(REFRESH, t.refreshToken);
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS);
  await SecureStore.deleteItemAsync(REFRESH);
}

export async function hasSession(): Promise<boolean> {
  return (await SecureStore.getItemAsync(REFRESH)) != null;
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const token = await SecureStore.getItemAsync(REFRESH);
    if (!token) return false;
    try {
      const res = await fetch(`${API_URL}/app/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
      });
      if (!res.ok) {
        await clearTokens();
        return false;
      }
      await saveTokens((await res.json()) as Tokens);
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

export interface Options {
  method?: 'GET' | 'POST';
  body?: unknown;
  form?: FormData;
  auth?: boolean;
}

export async function api<T = void>(path: string, opts: Options = {}): Promise<T> {
  const send = async () => {
    const headers: Record<string, string> = {};
    if (opts.auth !== false) {
      const token = await SecureStore.getItemAsync(ACCESS);
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    return fetch(`${API_URL}${path}`, {
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
    throw new ApiError(0, 'Could not reach Kora Lend. Check your connection and try again.');
  }
  if (!res.ok) throw new ApiError(res.status, await messageOf(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
