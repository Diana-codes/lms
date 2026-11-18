import { accessToken, API_URL, ApiError, messageOfText, refresh } from './api';

/**
 * Uploads and downloads in the web build. The image and document pickers
 * give a blob: or data: address in the browser; it is read with fetch and
 * sent as ordinary multipart form data.
 */
export async function uploadFile<T>(
  path: string,
  file: { uri: string; mimeType: string; name?: string },
): Promise<T> {
  let blob: Blob;
  try {
    blob = await (await fetch(file.uri)).blob();
  } catch {
    throw new ApiError(0, 'Could not read that file. Choose it again.');
  }
  const ext = file.mimeType === 'application/pdf' ? 'pdf' : file.mimeType.split('/')[1] || 'jpg';
  const send = async () => {
    const form = new FormData();
    form.append('file', new File([blob], file.name ?? `upload.${ext}`, { type: file.mimeType }));
    const token = await accessToken();
    return fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
  };
  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && (await refresh())) res = await send();
  } catch {
    throw new ApiError(
      0,
      'Could not reach Bridge to Finance. Check your connection and try again.',
    );
  }
  const body = await res.text();
  if (!res.ok) throw new ApiError(res.status, messageOfText(res.status, body));
  return JSON.parse(body) as T;
}

/** Download a file the borrower may see and open it in a new browser tab. */
export async function openFile(path: string, fileName: string): Promise<void> {
  // Open the tab now, while the click still counts, or the browser blocks it.
  const tab = window.open('', '_blank');
  const download = async () => {
    const token = await accessToken();
    return fetch(`${API_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };
  let res: Response;
  try {
    res = await download();
    if (res.status === 401 && (await refresh())) res = await download();
  } catch {
    tab?.close();
    throw new ApiError(0, 'Could not download the file. Check your connection and try again.');
  }
  if (!res.ok) {
    tab?.close();
    throw new ApiError(res.status, messageOfText(res.status, await res.text()));
  }
  const url = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = url;
  else {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  }
}

/** A loan agreement or other PDF. */
export const openPdf = (path: string, fileName: string) => openFile(path, fileName);
