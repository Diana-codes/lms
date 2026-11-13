import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

/**
 * ID photos and selfies. Files are written under UPLOAD_DIR with a random
 * name; the storage key is what gets recorded on the KYC document. The
 * contents are never logged. For production, point this at object storage
 * hosted in Rwanda (the data-residency rule in the brief).
 */
@Injectable()
export class UploadsService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async store(
    borrowerId: string,
    kind: 'id' | 'selfie',
    file: { mimetype: string; size: number; buffer: Buffer },
  ): Promise<string> {
    const ext = ALLOWED.get(file.mimetype);
    if (!ext) throw new BadRequestException('Upload a JPEG, PNG or WebP photo');
    if (file.size > UPLOAD_MAX_BYTES) throw new BadRequestException('The photo must be under 8 MB');
    if (!this.looksLikeImage(file.buffer, file.mimetype))
      throw new BadRequestException('That file is not a photo');
    const key = `kyc/${borrowerId}/${kind}-${randomUUID()}.${ext}`;
    const target = path.join(this.env.UPLOAD_DIR, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.buffer, { mode: 0o600 });
    return key;
  }

  /** Check the first bytes, not just the declared type. */
  private looksLikeImage(buf: Buffer, mime: string): boolean {
    if (buf.length < 12) return false;
    if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8;
    if (mime === 'image/png')
      return buf
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    return buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  }
}
