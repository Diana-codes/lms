import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { ApiError } from './api';

/**
 * Photos straight off a modern phone camera can be 10 MB or more, over the
 * API's 8 MB limit, and slow and costly on mobile data. Every photo is
 * shrunk to at most 2000px on its long side and saved as JPEG before upload:
 * still sharp enough to read an ID card, usually well under 1 MB. This also
 * turns iPhone HEIC photos into JPEG, which the API accepts.
 */
const LONG_EDGE = 2000;

export interface UploadFile {
  uri: string;
  name: string;
  mimeType: string;
}

export async function preparePhoto(
  asset: { uri: string; width: number; height: number },
  baseName: string,
): Promise<UploadFile> {
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > LONG_EDGE) {
    ctx.resize(asset.width >= asset.height ? { width: LONG_EDGE } : { height: LONG_EDGE });
  }
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  return { uri: saved.uri, name: `${baseName}.jpg`, mimeType: 'image/jpeg' };
}

/** An upload that breaks off mid-way looks like no connection; say what to try instead. */
export function uploadErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 0)
    return 'The upload did not finish. Check your connection and try again, or send a smaller file.';
  if (err instanceof ApiError && err.status === 413)
    return 'That file is over 8 MB. Try a photo instead, or a smaller PDF.';
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}
