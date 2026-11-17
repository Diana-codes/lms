import { randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DOCUMENT_INFO, type DocumentType } from '@kora/core';
import { ENV, type Env } from '../config/env';

const PHOTOS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const PDF = 'application/pdf';
export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

export interface UploadedFileLike {
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface StoredFile {
  key: string;
  mimeType: string;
  sizeBytes: number;
}

/** Check the first bytes of a file, not just the type the phone declared. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp';
  if (buf.subarray(0, 5).toString() === '%PDF-') return PDF;
  return null;
}

/**
 * KYC files: ID photos, selfies and PDFs such as RDB certificates. Files are
 * written under UPLOAD_DIR with a random name, readable only by the API; the
 * storage key is what gets recorded on the KYC document. Contents are never
 * logged. For production, point this at encrypted object storage hosted in
 * Rwanda (the data-residency rule in the brief) — only this class changes.
 */
@Injectable()
export class UploadsService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async store(borrowerId: string, type: DocumentType, file: UploadedFileLike): Promise<StoredFile> {
    const photoOnly = DOCUMENT_INFO[type].accepts === 'photo';
    if (file.size > UPLOAD_MAX_BYTES) throw new BadRequestException('The file must be under 8 MB');
    const declared = file.mimetype === PDF || PHOTOS.has(file.mimetype);
    const actual = sniffMime(file.buffer);
    // Both what the phone says it is and what the bytes say must be allowed.
    if (!declared || !actual || (actual === PDF && photoOnly)) {
      throw new BadRequestException(
        photoOnly ? 'Upload a JPEG, PNG or WebP photo' : 'Upload a photo or a PDF',
      );
    }
    const ext = actual === PDF ? 'pdf' : PHOTOS.get(actual)!;
    const slug = type === 'NATIONAL_ID' ? 'id' : type.toLowerCase().replace(/_/g, '-');
    const key = `${UploadsService.prefix(borrowerId)}${slug}-${randomUUID()}.${ext}`;
    const target = this.pathOf(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.buffer, { mode: 0o600 });
    return { key, mimeType: actual, sizeBytes: file.size };
  }

  /** Every key for a borrower starts with this, so one borrower can't claim another's file. */
  static prefix(borrowerId: string): string {
    return `kyc/${borrowerId}/`;
  }

  /** The file on disk for a stored key, or null if it is not there. */
  async locate(key: string | null | undefined): Promise<string | null> {
    if (!key) return null;
    try {
      const target = this.pathOf(key);
      return (await stat(target)).isFile() ? target : null;
    } catch {
      return null;
    }
  }

  /** Keys come from our own database, but never let one point outside the upload folder. */
  private pathOf(key: string): string {
    const root = path.resolve(this.env.UPLOAD_DIR);
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep)) throw new BadRequestException('Bad storage key');
    return target;
  }
}
