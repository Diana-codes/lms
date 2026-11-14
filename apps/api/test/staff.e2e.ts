import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import type { PrismaClient, StaffRole } from '../src/generated/prisma/client';
import { lastCodeTo, smsTwoFactor, testPhone } from './sign-in';
import { testPrisma } from './test-db';

/** Staff management by company administrators, and password changes. */
const PASSWORD = `e2e-${randomUUID()}`;
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

let app: INestApplication;
let prisma: PrismaClient;
let passwordHash: string;

const http = () => request(app.getHttpServer());
const cookiesOf = (res: request.Response): string[] =>
  ([] as string[]).concat(res.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]!);
const email = (tag: string) => `e2e-staff-${tag}-${randomUUID()}@koralend.test`;

/** Confirmed sign-in phones, by email. */
const phones = new Map<string, string>();

async function makeUser(role: StaffRole) {
  const address = email(role.toLowerCase());
  const factor = smsTwoFactor();
  const user = await prisma.user.create({
    data: { email: address, passwordHash, firstName: 'E2E', lastName: role, role, ...factor },
  });
  phones.set(address, factor.phone);
  return { id: user.id, email: address };
}

/**
 * Signs in (with the texted code, for accounts that have a confirmed phone)
 * and returns a client that sends the session cookies and origin.
 */
async function signIn(address: string, password = PASSWORD) {
  let res = await http().post('/auth/login').send({ email: address, password }).expect(200);
  if (res.body.status === 'TWO_FACTOR_REQUIRED') {
    res = await http()
      .post('/auth/2fa/verify')
      .send({
        challengeToken: res.body.challengeToken,
        code: lastCodeTo(app, phones.get(address)!),
      })
      .expect(200);
  }
  const cookies = cookiesOf(res);
  return {
    body: res.body as { user: { mustChangePassword: boolean } },
    get: (path: string) => http().get(path).set('Cookie', cookies),
    post: (path: string) => http().post(path).set('Cookie', cookies).set('Origin', ORIGIN),
    patch: (path: string) => http().patch(path).set('Cookie', cookies).set('Origin', ORIGIN),
  };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  prisma = testPrisma();
  passwordHash = await hashPassword(PASSWORD);
});

afterAll(async () => {
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-staff-' } },
    data: { isActive: false },
  });
  await app.close();
  await prisma.$disconnect();
});

describe('staff management', () => {
  it('an admin adds someone, who must choose a new password before anything else', async () => {
    const admin = await signIn((await makeUser('ADMIN')).email);
    const address = email('new');
    const temporary = `temp-${randomUUID()}`;
    const created = await admin
      .post('/users')
      .send({
        email: address.toUpperCase(),
        firstName: 'Aline',
        lastName: 'Uwase',
        role: 'LOAN_OFFICER',
        password: temporary,
      })
      .expect(201);
    expect(created.body.email).toBe(address);

    const newcomer = await signIn(address, temporary);
    expect(newcomer.body.user.mustChangePassword).toBe(true);
    const blocked = await newcomer.get('/applications').expect(403);
    expect(blocked.body.message).toBe('Choose a new password first');
    await newcomer.get('/auth/me').expect(200);
    // Two-factor setup waits until the password is their own.
    await newcomer.post('/auth/2fa/sms/start').send({ phone: testPhone() }).expect(403);

    await newcomer
      .post('/auth/password')
      .send({ currentPassword: 'wrong-password', newPassword: `new-${randomUUID()}` })
      .expect(401);
    await newcomer
      .post('/auth/password')
      .send({ currentPassword: temporary, newPassword: temporary })
      .expect(400);
    const chosen = `chosen-${randomUUID()}`;
    await newcomer
      .post('/auth/password')
      .send({ currentPassword: temporary, newPassword: chosen })
      .expect(204);

    // Then two-factor, which is required, then everything else.
    const next = await newcomer.get('/applications').expect(403);
    expect(next.body.message).toBe('Turn on two-factor sign-in first');
    const phone = testPhone();
    await newcomer.post('/auth/2fa/sms/start').send({ phone }).expect(200);
    await newcomer
      .post('/auth/2fa/sms/confirm')
      .send({ code: lastCodeTo(app, phone) })
      .expect(200);
    phones.set(address, phone);
    await newcomer.get('/applications').expect(200);

    await http().post('/auth/login').send({ email: address, password: temporary }).expect(401);
    await signIn(address, chosen);
  });

  it('refuses a duplicate email within the company', async () => {
    const admin = await signIn((await makeUser('ADMIN')).email);
    const existing = await makeUser('MANAGER');
    await admin
      .post('/users')
      .send({
        email: existing.email,
        firstName: 'Dup',
        lastName: 'Licate',
        role: 'MANAGER',
        password: `temp-${randomUUID()}`,
      })
      .expect(409);
  });

  it('only admins manage staff; managers can only look', async () => {
    const manager = await signIn((await makeUser('MANAGER')).email);
    const officer = await makeUser('LOAN_OFFICER');
    await manager.get('/users').expect(200);
    await manager.patch(`/users/${officer.id}`).send({ role: 'MANAGER' }).expect(403);
    await manager
      .post('/users')
      .send({
        email: email('x'),
        firstName: 'X',
        lastName: 'Y',
        role: 'ADMIN',
        password: `temp-${randomUUID()}`,
      })
      .expect(403);
  });

  it('a role change or deactivation ends the person’s sessions at once', async () => {
    const admin = await signIn((await makeUser('ADMIN')).email);
    const officer = await makeUser('LOAN_OFFICER');
    const session = await signIn(officer.email);
    await session.get('/applications').expect(200);

    await admin.patch(`/users/${officer.id}`).send({ role: 'COLLECTIONS_AGENT' }).expect(204);
    await session.get('/applications').expect(401);

    const again = await signIn(officer.email);
    await admin.patch(`/users/${officer.id}`).send({ isActive: false }).expect(204);
    await again.get('/auth/me').expect(401);
    await http().post('/auth/login').send({ email: officer.email, password: PASSWORD }).expect(401);

    const actions = (
      await prisma.auditLog.findMany({
        where: { entityId: officer.id },
        orderBy: { createdAt: 'asc' },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['staff.update', 'staff.deactivate']));
  });

  it('admins cannot lock themselves out', async () => {
    const me = await makeUser('ADMIN');
    const admin = await signIn(me.email);
    await admin.patch(`/users/${me.id}`).send({ isActive: false }).expect(400);
    await admin.patch(`/users/${me.id}`).send({ role: 'MANAGER' }).expect(400);
    await admin.patch(`/users/${me.id}`).send({ firstName: 'Renamed' }).expect(204);
  });

  it('a password reset signs the person out and forces a new password', async () => {
    const admin = await signIn((await makeUser('ADMIN')).email);
    const officer = await makeUser('LOAN_OFFICER');
    const session = await signIn(officer.email);
    const temporary = `reset-${randomUUID()}`;
    await admin.post(`/users/${officer.id}/reset-password`).send({ password: 'short' }).expect(400);
    await admin
      .post(`/users/${officer.id}/reset-password`)
      .send({ password: temporary })
      .expect(204);
    await session.get('/auth/me').expect(401);
    const fresh = await signIn(officer.email, temporary);
    expect(fresh.body.user.mustChangePassword).toBe(true);
  });

  it('resets two-factor for someone who lost their phone', async () => {
    const admin = await signIn((await makeUser('ADMIN')).email);
    const officer = await makeUser('LOAN_OFFICER');
    await prisma.user.update({
      where: { id: officer.id },
      data: { totpEnabledAt: new Date(), totpSecretEnc: 'x' },
    });
    await admin.post(`/users/${officer.id}/reset-two-factor`).expect(204);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: officer.id } });
    expect(after.totpEnabledAt).toBeNull();
    expect(after.totpSecretEnc).toBeNull();
    expect(after.phoneVerifiedAt).toBeNull();
    // They set it up again at their next sign-in.
    const back = await http()
      .post('/auth/login')
      .send({ email: officer.email, password: PASSWORD })
      .expect(200);
    expect(back.body.status).toBe('OK');
    expect(back.body.user.twoFactorEnabled).toBe(false);
  });

  it('a new phone number must be confirmed by its owner', async () => {
    const admin = await signIn((await makeUser('ADMIN')).email);
    const officer = await makeUser('LOAN_OFFICER');
    const session = await signIn(officer.email);
    await admin.patch(`/users/${officer.id}`).send({ phone: testPhone() }).expect(204);
    await session.get('/auth/me').expect(401);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: officer.id } });
    expect(after.phoneVerifiedAt).toBeNull();
  });

  it('admins add branches and assign staff to them', async () => {
    const admin = await signIn((await makeUser('ADMIN')).email);
    const code = `B${randomUUID().slice(0, 6)}`;
    const branch = await admin
      .post('/branches')
      .send({ code, name: `Branch ${code}`, district: 'Gasabo' })
      .expect(201);
    await admin.post('/branches').send({ code, name: 'Again', district: 'Gasabo' }).expect(409);
    const officer = await makeUser('LOAN_OFFICER');
    await admin.patch(`/users/${officer.id}`).send({ branchId: branch.body.id }).expect(204);
    const list = await admin.get('/users').expect(200);
    const row = (list.body as { id: string; branch: string | null }[]).find(
      (u) => u.id === officer.id,
    );
    expect(row?.branch).toBe(`Branch ${code}`);
  });
});
