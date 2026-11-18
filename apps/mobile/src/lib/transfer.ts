import { File, Paths, UploadType } from 'expo-file-system';
import { accessToken, API_URL, ApiError, messageOfText, refresh } from './api';

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
    const token = await accessToken();
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
    throw new ApiError(
      0,
      'Could not reach Bridge to Finance. Check your connection and try again.',
    );
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
    const token = await accessToken();
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
