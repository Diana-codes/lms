import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { redactDeep } from '../audit/audit.service';
import { hashPassword, verifyPassword } from '../auth/password';
import { loadEnv } from '../config/env';
import { installBigIntJson } from './bigint-json';
import { PiiCrypto } from './pii-crypto';
import { ZodPipe } from './zod.pipe';

const KEY = Buffer.alloc(32, 7).toString('base64');
const HASH_KEY = Buffer.alloc(48, 9).toString('base64');

describe('PiiCrypto', () => {
  const crypto = new PiiCrypto(KEY, HASH_KEY);

  it('round-trips and never stores the plain value', () => {
    const stored = crypto.encrypt('1198780012345821');
    expect(stored.startsWith('v1.')).toBe(true);
    expect(stored).not.toContain('1198780012345821');
    expect(crypto.decrypt(stored)).toBe('1198780012345821');
  });

  it('uses a fresh nonce each time', () => {
    expect(crypto.encrypt('same')).not.toBe(crypto.encrypt('same'));
  });

  it('refuses tampered or foreign ciphertext', () => {
    const stored = crypto.encrypt('1198780012345821');
    const parts = stored.split('.');
    const flipped = Buffer.from(parts[2]!, 'base64url');
    flipped[0] = flipped[0]! ^ 1;
    parts[2] = flipped.toString('base64url');
    expect(() => crypto.decrypt(parts.join('.'))).toThrow();
    expect(() => crypto.decrypt('plain text')).toThrow();
    const other = new PiiCrypto(Buffer.alloc(32, 8).toString('base64'), HASH_KEY);
    expect(() => other.decrypt(stored)).toThrow();
  });

  it('gives a stable keyed hash for lookups', () => {
    expect(crypto.lookupHash('1198780012345821')).toBe(crypto.lookupHash(' 1198780012345821 '));
    expect(crypto.lookupHash('1198780012345821')).not.toBe(crypto.lookupHash('1198780012345822'));
  });

  it('rejects keys of the wrong size', () => {
    expect(() => new PiiCrypto(Buffer.alloc(16).toString('base64'), HASH_KEY)).toThrow();
    expect(() => new PiiCrypto(KEY, Buffer.alloc(8).toString('base64'))).toThrow();
  });
});

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});

describe('ZodPipe', () => {
  const pipe = new ZodPipe(z.object({ amount: z.string().regex(/^\d+$/) }));

  it('passes valid input through', () => {
    expect(pipe.transform({ amount: '4500000' })).toEqual({ amount: '4500000' });
  });

  it('reports the field, not the value', () => {
    try {
      pipe.transform({ amount: '0788123412.5' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const body = JSON.stringify((err as BadRequestException).getResponse());
      expect(body).toContain('"path":"amount"');
      expect(body).not.toContain('0788123412');
    }
  });
});

describe('audit redaction', () => {
  it('masks phone and ID numbers anywhere in the metadata', () => {
    const out = redactDeep({
      note: 'Called +250788123412',
      nested: [{ id: '1198780012345821' }],
      amount: 4_500_000n,
      count: 3,
    });
    expect(out).toEqual({
      note: 'Called +250 78• ••• 412',
      nested: [{ id: '•••• •••• •••• •821' }],
      amount: '4500000',
      count: 3,
    });
  });
});

describe('BigInt JSON', () => {
  it('serialises money as a string of digits, never a number', () => {
    installBigIntJson();
    expect(JSON.stringify({ amount: 9_007_199_254_740_993n })).toBe(
      '{"amount":"9007199254740993"}',
    );
  });
});

describe('loadEnv', () => {
  const good = {
    DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
    JWT_ACCESS_SECRET: Buffer.alloc(48, 1).toString('base64'),
    PII_ENCRYPTION_KEY: KEY,
    PII_HASH_KEY: HASH_KEY,
  };

  it('applies defaults', () => {
    const env = loadEnv(good);
    expect(env.PORT).toBe(4000);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
  });

  it('names the missing variables without printing any values', () => {
    expect(() => loadEnv({ ...good, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
    try {
      loadEnv({ ...good, PII_ENCRYPTION_KEY: 'c2VjcmV0LXZhbHVl' });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain('c2VjcmV0LXZhbHVl');
    }
  });

  it('insists on secure cookies in production', () => {
    expect(() => loadEnv({ ...good, NODE_ENV: 'production' })).toThrow(/COOKIE_SECURE/);
    expect(loadEnv({ ...good, NODE_ENV: 'production', COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(
      true,
    );
  });
});
