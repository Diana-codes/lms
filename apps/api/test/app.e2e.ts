import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import {
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  REFRESH_GRACE_SECONDS,
} from '../src/auth/auth.service';
import { hashPassword } from '../src/auth/password';
import { totpCode, totpStep } from '../src/auth/totp';
import type { StaffRole } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * End-to-end tests against a real Postgres. They create their own users
 * (unique per run) and do not depend on the seed data.
 */
const PASSWORD = `e2e-${randomUUID()}`;
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

let app: INestApplication;
let prisma: PrismaService;
let passwordHash: string;

async function makeUser(role: StaffRole): Promise<{ id: string; email: string }> {
  const email = `e2e-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
  const user = await prisma.user.create({
    data: { email, passwordHash, firstName: 'E2E', lastName: role, role },
  });
  return { id: user.id, email };
}

const http = () => request(app.getHttpServer());
const login = (email: string, password = PASSWORD) =>
  http().post('/auth/login').send({ email, password });
const cookiesOf = (res: request.Response): string[] =>
  ([] as string[]).concat(res.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]!);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  passwordHash = await hashPassword(PASSWORD);
});

afterAll(async () => {
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-' } },
    data: { isActive: false },
  });
  await app.close();
});

describe('health', () => {
  it('is public and checks the database', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
  });
});

describe('sign-in', () => {
  it('everything else needs a session', async () => {
    await http().get('/auth/me').expect(401);
    await http().get('/users').expect(401);
    await http().get('/system/stats').expect(401);
  });

  it('signs in with httpOnly cookies and returns the profile', async () => {
    const user = await makeUser('LOAN_OFFICER');
    const res = await login(user.email.toUpperCase()).expect(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.user).toMatchObject({ email: user.email, role: 'LOAN_OFFICER' });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const raw = ([] as string[]).concat(res.get('Set-Cookie') ?? []);
    expect(raw).toHaveLength(2);
    for (const cookie of raw) {
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
    }

    const me = await http().get('/auth/me').set('Cookie', cookiesOf(res)).expect(200);
    expect(me.body).toMatchObject({ id: user.id, role: 'LOAN_OFFICER', twoFactorEnabled: false });
    expect(me.body.sessionId).toBeUndefined();

    // The mobile app will use the same token as a Bearer header.
    await http().get('/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const user = await makeUser('LOAN_OFFICER');
    const wrong = await login(user.email, 'not-the-password').expect(401);
    const unknown = await login(`nobody-${randomUUID()}@koralend.test`).expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('validates input without echoing it back', async () => {
    const res = await http()
      .post('/auth/login')
      .send({ email: 'not-an-email', password: 'hunter2-secret' })
      .expect(400);
    expect(JSON.stringify(res.body)).not.toContain('hunter2-secret');
  });

  it(`locks the account after ${MAX_FAILED_LOGINS} failed attempts`, async () => {
    const user = await makeUser('LOAN_OFFICER');
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await login(user.email, 'wrong').expect(401);
    const res = await login(user.email).expect(429);
    expect(res.body.message).toContain(String(LOCKOUT_MINUTES));
    const audit = await prisma.auditLog.findFirst({
      where: { actorId: user.id, action: 'auth.login.locked' },
    });
    expect(audit).not.toBeNull();
  });

  it('refuses deactivated staff, including sessions they already hold', async () => {
    const user = await makeUser('LOAN_OFFICER');
    const res = await login(user.email).expect(200);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    await http().get('/auth/me').set('Cookie', cookiesOf(res)).expect(401);
    await login(user.email).expect(401);
  });

  it('rotates refresh tokens and signs out', async () => {
    const user = await makeUser('LOAN_OFFICER');
    const first = await login(user.email).expect(200);
    const firstCookies = cookiesOf(first);

    const refreshed = await http().post('/auth/refresh').set('Cookie', firstCookies).expect(200);
    const newCookies = cookiesOf(refreshed);
    expect(newCookies.find((c) => c.startsWith('kl_refresh='))).not.toBe(
      firstCookies.find((c) => c.startsWith('kl_refresh=')),
    );

    // A request racing with the rotation (still holding the old token) gets
    // a new access token, but no second refresh token.
    const raced = await http().post('/auth/refresh').set('Cookie', firstCookies).expect(200);
    expect(cookiesOf(raced).some((c) => c.startsWith('kl_access='))).toBe(true);
    expect(cookiesOf(raced).some((c) => c.startsWith('kl_refresh='))).toBe(false);

    await http().post('/auth/logout').set('Cookie', newCookies).expect(204);
    await http().get('/auth/me').set('Cookie', newCookies).expect(401);
    await http().post('/auth/refresh').set('Cookie', newCookies).expect(401);
  });

  it('ends the session if a replaced refresh token turns up after the grace window', async () => {
    const user = await makeUser('LOAN_OFFICER');
    const first = await login(user.email).expect(200);
    const refreshed = await http()
      .post('/auth/refresh')
      .set('Cookie', cookiesOf(first))
      .expect(200);
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { rotatedAt: new Date(Date.now() - (REFRESH_GRACE_SECONDS + 5) * 1000) },
    });
    await http().post('/auth/refresh').set('Cookie', cookiesOf(first)).expect(401);
    // The whole session is revoked, including the newer token.
    await http().post('/auth/refresh').set('Cookie', cookiesOf(refreshed)).expect(401);
    const audit = await prisma.auditLog.findFirst({
      where: { actorId: user.id, action: 'auth.refresh.reuse_detected' },
    });
    expect(audit).not.toBeNull();
  });

  it('blocks cookie-authenticated writes from another site', async () => {
    const user = await makeUser('LOAN_OFFICER');
    const res = await login(user.email).expect(200);
    await http()
      .post('/auth/logout')
      .set('Cookie', cookiesOf(res))
      .set('Origin', 'https://evil.example')
      .expect(403);
    await http()
      .post('/auth/logout')
      .set('Cookie', cookiesOf(res))
      .set('Origin', ORIGIN)
      .expect(204);
  });

  it('writes sign-ins to the audit log', async () => {
    const user = await makeUser('MANAGER');
    await login(user.email).expect(200);
    await login(user.email, 'wrong').expect(401);
    const actions = (
      await prisma.auditLog.findMany({ where: { actorId: user.id }, orderBy: { createdAt: 'asc' } })
    ).map((a) => a.action);
    expect(actions).toEqual(['auth.login', 'auth.login.failed']);
  });
});

describe('roles', () => {
  it('lets managers and admins see the staff list, and nobody else', async () => {
    for (const [role, status] of [
      ['ADMIN', 200],
      ['MANAGER', 200],
      ['LOAN_OFFICER', 403],
      ['COLLECTIONS_AGENT', 403],
    ] as const) {
      const user = await makeUser(role);
      const session = await login(user.email).expect(200);
      const res = await http().get('/users').set('Cookie', cookiesOf(session)).expect(status);
      if (status === 200) {
        expect(JSON.stringify(res.body)).not.toContain('passwordHash');
        expect(JSON.stringify(res.body)).not.toContain('totpSecret');
      }
      await http().get('/system/stats').set('Cookie', cookiesOf(session)).expect(status);
    }
  });

  it('applies a role change straight away, without a new sign-in', async () => {
    const user = await makeUser('MANAGER');
    const session = await login(user.email).expect(200);
    await http().get('/users').set('Cookie', cookiesOf(session)).expect(200);
    await prisma.user.update({ where: { id: user.id }, data: { role: 'LOAN_OFFICER' } });
    await http().get('/users').set('Cookie', cookiesOf(session)).expect(403);
  });
});

describe('two-factor sign-in', () => {
  it('sets up, then requires a code at sign-in, and refuses a replayed code', async () => {
    const user = await makeUser('MANAGER');
    const session = await login(user.email).expect(200);
    const cookies = cookiesOf(session);

    const setup = await http().post('/auth/2fa/setup').set('Cookie', cookies).expect(200);
    const secret: string = setup.body.secret;
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');

    // Stored encrypted, never in the clear.
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.totpSecretEnc).not.toContain(secret);

    await http()
      .post('/auth/2fa/enable')
      .set('Cookie', cookies)
      .send({ code: '000000' })
      .expect(400);
    const step = totpStep();
    await http()
      .post('/auth/2fa/enable')
      .set('Cookie', cookies)
      .send({ code: totpCode(secret, step - 1) })
      .expect(204);

    const challenge = await login(user.email).expect(200);
    expect(challenge.body.status).toBe('TOTP_REQUIRED');
    expect(challenge.get('Set-Cookie')).toBeUndefined();
    const challengeToken: string = challenge.body.challengeToken;

    // The challenge token is not a session.
    await http().get('/auth/me').set('Authorization', `Bearer ${challengeToken}`).expect(401);

    // The code used during setup cannot be used again.
    await http()
      .post('/auth/2fa/verify')
      .send({ challengeToken, code: totpCode(secret, step - 1) })
      .expect(401);

    const done = await http()
      .post('/auth/2fa/verify')
      .send({ challengeToken, code: totpCode(secret, step + 1) })
      .expect(200);
    const me = await http().get('/auth/me').set('Cookie', cookiesOf(done)).expect(200);
    expect(me.body.twoFactorEnabled).toBe(true);
  });
});

describe('ledger safeguards in the database', () => {
  async function accounts() {
    const stamp = randomUUID().slice(0, 8);
    const [a, b] = await Promise.all([
      prisma.ledgerAccount.create({
        data: { code: `T-${stamp}-A`, name: 'Test A', type: 'ASSET' },
      }),
      prisma.ledgerAccount.create({
        data: { code: `T-${stamp}-B`, name: 'Test B', type: 'EQUITY' },
      }),
    ]);
    return [a.id, b.id] as const;
  }

  const post = (debit: bigint, credit: bigint, ids: readonly [string, string]) =>
    prisma.ledgerTransaction.create({
      data: {
        type: 'ADJUSTMENT',
        idempotencyKey: `e2e:${randomUUID()}`,
        effectiveOn: new Date(),
        entries: {
          create: [
            { accountId: ids[0], direction: 'DEBIT', amount: debit },
            { accountId: ids[1], direction: 'CREDIT', amount: credit },
          ],
        },
      },
      include: { entries: true },
    });

  it('accepts a balanced transaction', async () => {
    const tx = await post(1000n, 1000n, await accounts());
    expect(tx.entries).toHaveLength(2);
  });

  it('rejects a transaction whose debits and credits differ', async () => {
    await expect(post(1000n, 999n, await accounts())).rejects.toThrow(/does not balance/);
  });

  it('rejects a transaction with no entries', async () => {
    await expect(
      prisma.ledgerTransaction.create({
        data: {
          type: 'ADJUSTMENT',
          idempotencyKey: `e2e:${randomUUID()}`,
          effectiveOn: new Date(),
        },
      }),
    ).rejects.toThrow(/has no entries/);
  });

  it('rejects zero and negative amounts', async () => {
    await expect(post(0n, 0n, await accounts())).rejects.toThrow();
    await expect(post(-5n, -5n, await accounts())).rejects.toThrow();
  });

  it('never lets an entry or a transaction be edited or deleted', async () => {
    const tx = await post(500n, 500n, await accounts());
    const entry = tx.entries[0]!;
    await expect(
      prisma.ledgerEntry.update({ where: { id: entry.id }, data: { amount: 1n } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.ledgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(
      prisma.ledgerTransaction.update({ where: { id: tx.id }, data: { memo: 'edited' } }),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses a second transaction with the same idempotency key', async () => {
    const ids = await accounts();
    const key = `e2e:${randomUUID()}`;
    const data = {
      type: 'REPAYMENT' as const,
      idempotencyKey: key,
      effectiveOn: new Date(),
      entries: {
        create: [
          { accountId: ids[0], direction: 'DEBIT' as const, amount: 284_985n },
          { accountId: ids[1], direction: 'CREDIT' as const, amount: 284_985n },
        ],
      },
    };
    await prisma.ledgerTransaction.create({ data });
    await expect(prisma.ledgerTransaction.create({ data })).rejects.toThrow(/Unique constraint/);
    expect(await prisma.ledgerTransaction.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it('keeps the audit log append-only too', async () => {
    const row = await prisma.auditLog.create({ data: { action: 'e2e.test', actorType: 'SYSTEM' } });
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'changed' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});
