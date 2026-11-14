import { randomInt } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { expect } from 'vitest';
import { ProvidersService } from '../src/providers/providers.service';

/** A unique Rwandan mobile number the SMS simulator accepts (it refuses numbers ending 00). */
export function testPhone(): string {
  let phone: string;
  do phone = `+25078${randomInt(1_000_000, 10_000_000)}`;
  while (phone.endsWith('00'));
  return phone;
}

/** Account fields for texted sign-in codes on a confirmed number. */
export function smsTwoFactor(): { phone: string; phoneVerifiedAt: Date } {
  return { phone: testPhone(), phoneVerifiedAt: new Date() };
}

/** The newest six-digit code the platform SMS simulator texted to `phone`. */
export function lastCodeTo(app: INestApplication, phone: string): string {
  const outbox = app.get(ProvidersService).platformSmsSimulator.outbox;
  for (let i = outbox.length - 1; i >= 0; i--) {
    const match = outbox[i]!.to === phone ? /\b(\d{6})\b/.exec(outbox[i]!.message) : null;
    if (match) return match[1]!;
  }
  throw new Error(`No code was texted to ${phone}`);
}

/**
 * Staff sign-in for an account with texted codes: password, then the code
 * from the simulator. Returns the response that carries the session.
 */
export async function signInWithSms(
  app: INestApplication,
  account: { email: string; phone: string },
  password: string,
  company?: string,
): Promise<request.Response> {
  const http = () => {
    const agent = request(app.getHttpServer());
    return {
      post: (path: string) =>
        company ? agent.post(path).set('x-company', company) : agent.post(path),
    };
  };
  const first = await http()
    .post('/auth/login')
    .send({ email: account.email, password })
    .expect(200);
  expect(first.body.status).toBe('TWO_FACTOR_REQUIRED');
  expect(first.body.method).toBe('sms');
  return http()
    .post('/auth/2fa/verify')
    .send({ challengeToken: first.body.challengeToken, code: lastCodeTo(app, account.phone) })
    .expect(200);
}
