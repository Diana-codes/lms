import { File, Paths, UploadType } from 'expo-file-system';
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

function messageOfText(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) return parsed.message.join('. ');
    if (parsed.message) return parsed.message;
  } catch {
    // not JSON
  }
  return status >= 500
    ? 'Something went wrong on our side. Try again in a moment.'
    : `Request failed (${status})`;
}

/**
 * Upload one file as multipart/form-data (field "file"), using the phone's
 * native upload instead of fetch. Expo's fetch can't send React Native style
 * `{ uri }` form parts, so files go through expo-file-system, which reads the
 * file from disk and sends it with the MIME type we give.
 */
export async function uploadFile<T>(
  path: string,
  file: { uri: string; mimeType: string },
): Promise<T> {
  const send = async () => {
    const headers: Record<string, string> = {};
    const token = await SecureStore.getItemAsync(ACCESS);
    if (token) headers.Authorization = `Bearer ${token}`;
    return new File(file.uri).upload(`${API_URL}${path}`, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: file.mimeType,
      headers,
      sessionType: 'foreground',
    });
  };
  let res: Awaited<ReturnType<typeof send>>;
  try {
    res = await send();
    if (res.status === 401 && (await refresh())) res = await send();
  } catch (err) {
    // Shows in the Expo terminal, so a failed upload can be diagnosed.
    console.warn(`Upload to ${path} failed:`, err);
    throw new ApiError(0, 'Could not reach Kora Lend. Check your connection and try again.');
  }
  if (res.status < 200 || res.status >= 300)
    throw new ApiError(res.status, messageOfText(res.status, res.body));
  return JSON.parse(res.body) as T;
}

/**
 * Download a file the borrower is allowed to see (their loan agreement, a
 * document they sent) and open it in the phone's viewer, where they can
 * zoom, save or share it.
 */
export async function openFile(
  path: string,
  fileName: string,
  mimeType = 'application/pdf',
): Promise<void> {
  const download = async () => {
    const token = await SecureStore.getItemAsync(ACCESS);
    return File.downloadFileAsync(`${API_URL}${path}`, new File(Paths.cache, fileName), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      idempotent: true,
    });
  };
  let file: File;
  try {
    file = await download();
  } catch {
    // Most often an expired session: refresh once and try again.
    if (!(await refresh())) throw new ApiError(401, 'Please sign in again.');
    try {
      file = await download();
    } catch (err) {
      console.warn(`Download of ${path} failed:`, err);
      throw new ApiError(0, 'Could not download the file. Check your connection and try again.');
    }
  }
  if (await File.canPreview(file)) await File.preview(file, { mimeType });
  else throw new ApiError(0, 'This phone cannot open the file here. Ask your officer for a copy.');
}

/** A loan agreement or other PDF. */
export const openPdf = (path: string, fileName: string) => openFile(path, fileName);

export const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
