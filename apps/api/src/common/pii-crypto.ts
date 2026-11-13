import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * Field-level encryption for personal data (national IDs, 2FA secrets).
 * AES-256-GCM with a random 96-bit nonce per value. Stored form:
 *
 *   v1.<nonce>.<ciphertext>.<auth tag>     (each part base64url)
 *
 * The version prefix leaves room to rotate keys later.
 */
export class PiiCrypto {
  private readonly key: Buffer;
  private readonly hashKey: Buffer;

  constructor(encryptionKeyBase64: string, hashKeyBase64: string) {
    this.key = Buffer.from(encryptionKeyBase64, 'base64');
    this.hashKey = Buffer.from(hashKeyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('PII encryption key must be 32 bytes');
    if (this.hashKey.length < 32) throw new Error('PII hash key must be at least 32 bytes');
  }

  encrypt(plain: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', nonce, body, tag]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  decrypt(stored: string): string {
    const [version, nonce, body, tag] = stored.split('.');
    if (version !== 'v1' || !nonce || body === undefined || !tag) {
      throw new Error('Unrecognised encrypted value');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(nonce, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Keyed hash for exact-match lookups (e.g. duplicate national IDs) without decrypting. */
  lookupHash(value: string): string {
    return createHmac('sha256', this.hashKey).update(value.trim()).digest('base64url');
  }
}
