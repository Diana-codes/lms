import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGREEMENT_VERSION } from '../src/agreements/template';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import { DocumentsService } from '../src/documents/documents.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * KYC documents: a borrower uploads photos and PDFs in the app, an officer
 * opens, verifies or rejects them in the console, and the borrower is told.
 */
const PASSWORD = `e2e-${randomUUID()}`;
const PRODUCT = `E2ED-${randomUUID().slice(0, 8)}`;

let app: INestApplication;
let prisma: PrismaService;
const cookies: Record<'officer' | 'other' | 'manager' | 'collections', string[]> = {
  officer: [],
  other: [],
  manager: [],
  collections: [],
};

const http = () => request(app.getHttpServer());
const phone = () => `078${randomInt(1_000_000, 9_999_999)}`;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer\n%%EOF\n');

async function signInBorrower(number: string): Promise<string> {
  await http().post('/app/auth/request-code').send({ phone: number }).expect(200);
  const e164 = `+250${number.slice(1)}`;
  const challenge = await prisma.otpChallenge.findFirstOrThrow({
    where: { phone: e164 },
    orderBy: { createdAt: 'desc' },
  });
  let code = '';
  for (let i = 0; i < 1_000_000; i++) {
    const c = String(i).padStart(6, '0');
    if (createHash('sha256').update(`${e164}:${c}`).digest('base64url') === challenge.codeHash) {
      code = c;
      break;
    }
  }
  const res = await http().post('/app/auth/verify').send({ phone: number, code }).expect(200);
  return res.body.accessToken as string;
}

/** A borrower with an open application for the test product, created in the console. */
async function applicant(): Promise<{ number: string; borrowerCode: string; appCode: string }> {
  const number = phone();
  const res = await http()
    .post('/applications')
    .set('Cookie', cookies.officer)
    .send({
      name: `Doc Applicant ${randomUUID().slice(0, 5)}`,
      phone: number,
      productCode: PRODUCT,
      amount: '1500000',
      termMonths: 12,
    })
    .expect(201);
  return { number, borrowerCode: res.body.borrowerCode, appCode: res.body.code };
}

const upload = (token: string, type: string, file: Buffer, name: string, contentType: string) =>
  http()
    .post(`/app/documents/${type}`)
    .set(bearer(token))
    .attach('file', file, { filename: name, contentType });

type Item = { type: string; state: string; reason: string | null; required: boolean };
const item = (body: { items: Item[] }, type: string) => body.items.find((i) => i.type === type)!;

async function profileDocs(borrowerCode: string, who: keyof typeof cookies = 'officer') {
  const res = await http().get(`/borrowers/${borrowerCode}`).set('Cookie', cookies[who]);
  return res.body.documents as Array<{
    id: string;
    type: string;
    status: string;
    file: 'image' | 'pdf' | null;
    reviewable: boolean;
    canUndo: boolean;
    reason: string | null;
  }>;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  await prisma.product.create({
    data: {
      code: PRODUCT,
      name: 'E2E documents product',
      shortName: 'E2E docs',
      kind: 'SME',
      annualRateBps: 1700,
      minTermMonths: 6,
      maxTermMonths: 24,
      minAmount: 500_000n,
      maxAmount: 6_000_000n,
      requiredDocuments: ['NATIONAL_ID', 'SELFIE', 'BUSINESS_REGISTRATION', 'FINANCIAL_STATEMENTS'],
    },
  });
  const hash = await hashPassword(PASSWORD);
  for (const [role, key] of [
    ['LOAN_OFFICER', 'officer'],
    ['LOAN_OFFICER', 'other'],
    ['MANAGER', 'manager'],
    ['COLLECTIONS_AGENT', 'collections'],
  ] as const) {
    const email = `e2e-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
    await prisma.user.create({
      data: { email, passwordHash: hash, firstName: 'E2E', lastName: role, role },
    });
    const res = await http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    cookies[key] = ([] as string[])
      .concat(res.get('Set-Cookie') ?? [])
      .map((c) => c.split(';')[0]!);
  }
});

afterAll(async () => {
  await prisma.product.updateMany({ where: { code: PRODUCT }, data: { isActive: false } });
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-' } },
    data: { isActive: false },
  });
  await app.close();
});

describe('documents', () => {
  it('runs from upload in the app to review in the console', async () => {
    const { number, borrowerCode, appCode } = await applicant();
    const application = await prisma.application.findUniqueOrThrow({ where: { code: appCode } });
    expect(application).toMatchObject({ docsRequired: 4, docsReceived: 0 });
    const token = await signInBorrower(number);

    // The app lists what the product needs.
    let list = (await http().get('/app/documents').set(bearer(token)).expect(200)).body;
    expect(list).toMatchObject({
      applicationCode: appCode,
      required: 4,
      received: 0,
      needsAction: 4,
    });
    expect(list.items.map((i: Item) => i.state)).toEqual([
      'MISSING',
      'MISSING',
      'MISSING',
      'MISSING',
    ]);
    expect(
      (await http().get('/app/home').set(bearer(token)).expect(200)).body.documentsNeeded,
    ).toBe(4);

    // Only real photos and PDFs get in, and ID and selfie must be photos.
    await upload(token, 'NATIONAL_ID', PDF, 'id.pdf', 'application/pdf').expect(400);
    await upload(
      token,
      'BUSINESS_REGISTRATION',
      Buffer.from('MZ not really a pdf at all'),
      'x.pdf',
      'application/pdf',
    ).expect(400);
    await upload(token, 'BUSINESS_REGISTRATION', PDF, 'x.exe', 'application/octet-stream').expect(
      400,
    );
    await upload(token, 'PASSPORT', PNG, 'p.png', 'image/png').expect(400);
    await http().post('/app/documents/OTHER').set(bearer(token)).expect(400);

    list = (
      await upload(token, 'BUSINESS_REGISTRATION', PDF, 'rdb.pdf', 'application/pdf').expect(201)
    ).body;
    expect(item(list, 'BUSINESS_REGISTRATION').state).toBe('PENDING');
    await upload(token, 'NATIONAL_ID', JPEG, 'id.jpg', 'image/jpeg').expect(201);
    list = (await upload(token, 'SELFIE', PNG, 'me.png', 'image/png').expect(201)).body;
    expect(list).toMatchObject({ received: 3, needsAction: 1 });
    expect(await prisma.application.findUniqueOrThrow({ where: { code: appCode } })).toMatchObject({
      docsReceived: 3,
      docsRequired: 4,
    });
    // The officer is told there is something to check.
    expect(
      await prisma.notification.count({
        where: { kind: 'DOCUMENT', href: `/borrowers/${borrowerCode}` },
      }),
    ).toBe(3);

    // Sharing MoMo history covers the statements.
    const borrower = await prisma.borrower.findUniqueOrThrow({ where: { code: borrowerCode } });
    await prisma.consent.create({
      data: { borrowerId: borrower.id, type: 'MOMO_HISTORY', textVersion: 'e2e', channel: 'APP' },
    });
    list = (await http().get('/app/documents').set(bearer(token)).expect(200)).body;
    expect(item(list, 'FINANCIAL_STATEMENTS').state).toBe('WAIVED');
    expect(list.needsAction).toBe(0);

    // In the console: the officer sees the documents and can open them.
    let docs = await profileDocs(borrowerCode);
    const rdb = docs.find((d) => d.type === 'BUSINESS_REGISTRATION')!;
    expect(rdb).toMatchObject({ file: 'pdf', reviewable: true, status: 'Pending' });
    expect(docs.find((d) => d.type === 'NATIONAL_ID')!.file).toBe('image');

    const file = await http()
      .get(`/borrowers/${borrowerCode}/documents/${rdb.id}/file`)
      .set('Cookie', cookies.officer)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['cache-control']).toBe('no-store');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect((file.body as Buffer).equals(PDF)).toBe(true);
    expect(
      await prisma.auditLog.count({ where: { action: 'document.view', entityId: rdb.id } }),
    ).toBe(1);

    const id = docs.find((d) => d.type === 'NATIONAL_ID')!;
    const photo = await http()
      .get(`/borrowers/${borrowerCode}/documents/${id.id}/file`)
      .set('Cookie', cookies.officer)
      .expect(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    expect(photo.headers['content-security-policy']).toContain('sandbox');

    // Collections agents can't open identity papers; nobody can without signing in.
    await http()
      .get(`/borrowers/${borrowerCode}/documents/${rdb.id}/file`)
      .set('Cookie', cookies.collections)
      .expect(403);
    await http().get(`/borrowers/${borrowerCode}/documents/${rdb.id}/file`).expect(401);
    // A document can only be reached through its own borrower.
    await http()
      .get(`/borrowers/BR-00731/documents/${rdb.id}/file`)
      .set('Cookie', cookies.officer)
      .expect(404);

    // Rejecting asks for a reason, and tells the borrower in the app and by SMS.
    const reason = 'Part of the document is cut off. Please show all four corners.';
    await http()
      .post(`/borrowers/${borrowerCode}/documents/${rdb.id}/reject`)
      .set('Cookie', cookies.officer)
      .send({ reason: '' })
      .expect(400);
    await http()
      .post(`/borrowers/${borrowerCode}/documents/${rdb.id}/reject`)
      .set('Cookie', cookies.officer)
      .send({ reason })
      .expect(200);
    await http()
      .post(`/borrowers/${borrowerCode}/documents/${rdb.id}/verify`)
      .set('Cookie', cookies.officer)
      .expect(409);

    list = (await http().get('/app/documents').set(bearer(token)).expect(200)).body;
    expect(item(list, 'BUSINESS_REGISTRATION')).toMatchObject({ state: 'REJECTED', reason });
    expect(list.needsAction).toBe(1);
    const notes = (await http().get('/app/notifications').set(bearer(token)).expect(200)).body;
    expect(notes[0].title).toBe(`Please upload your Business registration (RDB) again: ${reason}`);
    const sms = await prisma.smsMessage.findFirstOrThrow({
      where: { borrowerId: borrower.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(sms.body).toContain('we could not accept your Business registration (RDB)');
    expect(sms.body).toContain(reason);
    expect(
      await prisma.auditLog.findFirstOrThrow({
        where: { action: 'document.reject', entityId: rdb.id },
      }),
    ).toMatchObject({ actorType: 'STAFF' });
    expect(await prisma.application.findUniqueOrThrow({ where: { code: appCode } })).toMatchObject({
      docsReceived: 3,
    });

    // A new upload replaces the rejected one; the old row is kept for the record.
    await upload(token, 'BUSINESS_REGISTRATION', PNG, 'rdb.png', 'image/png').expect(201);
    docs = await profileDocs(borrowerCode);
    expect(docs.filter((d) => d.type === 'BUSINESS_REGISTRATION')).toHaveLength(1);
    expect(docs.find((d) => d.type === 'BUSINESS_REGISTRATION')).toMatchObject({
      file: 'image',
      reviewable: true,
    });
    expect(
      await prisma.kycDocument.count({
        where: { borrowerId: borrower.id, type: 'BUSINESS_REGISTRATION' },
      }),
    ).toBe(2);
    expect(await prisma.application.findUniqueOrThrow({ where: { code: appCode } })).toMatchObject({
      docsReceived: 4,
    });

    // Verifying ID and selfie verifies the customer's identity.
    for (const type of ['NATIONAL_ID', 'SELFIE']) {
      const doc = docs.find((d) => d.type === type)!;
      await http()
        .post(`/borrowers/${borrowerCode}/documents/${doc.id}/verify`)
        .set('Cookie', cookies.manager)
        .expect(200);
    }
    expect(
      (await prisma.borrower.findUniqueOrThrow({ where: { code: borrowerCode } })).kycStatus,
    ).toBe('VERIFIED');
    await upload(token, 'NATIONAL_ID', JPEG, 'id.jpg', 'image/jpeg').expect(409);
    list = (await http().get('/app/documents').set(bearer(token)).expect(200)).body;
    expect(item(list, 'NATIONAL_ID').state).toBe('VERIFIED');
  });

  it('will not verify a document that has no file behind it', async () => {
    const { borrowerCode } = await applicant();
    const borrower = await prisma.borrower.findUniqueOrThrow({ where: { code: borrowerCode } });
    const doc = await prisma.kycDocument.create({
      data: {
        borrowerId: borrower.id,
        type: 'PROOF_OF_ADDRESS',
        storageKey: `kyc/${borrower.id}/missing.pdf`,
        mimeType: 'application/pdf',
      },
    });
    expect((await profileDocs(borrowerCode)).find((d) => d.id === doc.id)!.file).toBeNull();
    await http()
      .get(`/borrowers/${borrowerCode}/documents/${doc.id}/file`)
      .set('Cookie', cookies.officer)
      .expect(404);
    await http()
      .post(`/borrowers/${borrowerCode}/documents/${doc.id}/verify`)
      .set('Cookie', cookies.officer)
      .expect(409);
  });

  it("won't let an application claim another borrower's upload", async () => {
    const a = await applicant();
    const tokenA = await signInBorrower(a.number);
    const { body } = await http()
      .post('/app/apply/upload/id')
      .set(bearer(tokenA))
      .attach('file', PNG, { filename: 'id.png', contentType: 'image/png' })
      .expect(201);

    const b = await applicant();
    await prisma.application.update({ where: { code: b.appCode }, data: { stage: 'WITHDRAWN' } });
    const tokenB = await signInBorrower(b.number);
    const res = await http()
      .post('/app/apply')
      .set(bearer(tokenB))
      .send({
        productCode: PRODUCT,
        amount: '1000000',
        termMonths: 12,
        purpose: 'Stock',
        agreedTerms: true,
        agreementVersion: AGREEMENT_VERSION,
        idPhotoKey: body.key,
      })
      .expect(400);
    expect(res.body.message).toBe('Upload your photos again');
  });
});

describe('fixing mistakes', () => {
  type Full = Item & { documentId: string | null; hasFile: boolean; canRemove: boolean };

  it('lets the borrower view their file and remove one nobody has reviewed', async () => {
    const { number, borrowerCode } = await applicant();
    const token = await signInBorrower(number);
    let list = (await upload(token, 'NATIONAL_ID', JPEG, 'id.jpg', 'image/jpeg').expect(201)).body;
    const id = item(list, 'NATIONAL_ID') as Full;
    expect(id).toMatchObject({ state: 'PENDING', hasFile: true, canRemove: true });

    const file = await http()
      .get(`/app/documents/${id.documentId}/file`)
      .set(bearer(token))
      .expect(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(file.headers['cache-control']).toBe('no-store');
    // Nobody else's session can open it.
    const stranger = await applicant();
    const otherToken = await signInBorrower(stranger.number);
    await http().get(`/app/documents/${id.documentId}/file`).set(bearer(otherToken)).expect(404);
    await http().post(`/app/documents/${id.documentId}/remove`).set(bearer(otherToken)).expect(404);

    list = (
      await http().post(`/app/documents/${id.documentId}/remove`).set(bearer(token)).expect(200)
    ).body;
    expect(item(list, 'NATIONAL_ID').state).toBe('MISSING');
    expect((await profileDocs(borrowerCode)).some((d) => d.id === id.documentId)).toBe(false);
    const row = await prisma.kycDocument.findUniqueOrThrow({ where: { id: id.documentId! } });
    expect(row.withdrawnAt).not.toBeNull();
    expect(row.storageKey).not.toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { action: 'borrower.document.withdraw', entityId: id.documentId! },
      }),
    ).toBe(1);
    await http().post(`/app/documents/${id.documentId}/remove`).set(bearer(token)).expect(404);
    await http()
      .post(`/borrowers/${borrowerCode}/documents/${id.documentId}/verify`)
      .set('Cookie', cookies.officer)
      .expect(409);

    // Once reviewed, it can no longer be removed.
    list = (await upload(token, 'SELFIE', PNG, 'me.png', 'image/png').expect(201)).body;
    const selfie = item(list, 'SELFIE') as Full;
    await http()
      .post(`/borrowers/${borrowerCode}/documents/${selfie.documentId}/verify`)
      .set('Cookie', cookies.officer)
      .expect(200);
    list = (await http().get('/app/documents').set(bearer(token)).expect(200)).body;
    expect((item(list, 'SELFIE') as Full).canRemove).toBe(false);
    const locked = await http()
      .post(`/app/documents/${selfie.documentId}/remove`)
      .set(bearer(token))
      .expect(409);
    expect(locked.body.message).toContain('verified');
  });

  it('lets an officer undo their own rejection the same day, and corrects the borrower', async () => {
    const { number, borrowerCode } = await applicant();
    const token = await signInBorrower(number);
    const list = (await upload(token, 'NATIONAL_ID', JPEG, 'id.jpg', 'image/jpeg').expect(201))
      .body;
    const docId = (item(list, 'NATIONAL_ID') as Full).documentId!;
    const base = `/borrowers/${borrowerCode}/documents/${docId}`;
    await http()
      .post(`${base}/reject`)
      .set('Cookie', cookies.officer)
      .send({ reason: 'The photo is blurry. Retake it in good light.' })
      .expect(200);
    expect(
      (await prisma.kycDocument.findUniqueOrThrow({ where: { id: docId } })).rejectedById,
    ).toBeTruthy();

    // Another officer neither sees Undo nor may use it; the manager may.
    expect((await profileDocs(borrowerCode, 'officer')).find((d) => d.id === docId)?.canUndo).toBe(
      true,
    );
    expect((await profileDocs(borrowerCode, 'other')).find((d) => d.id === docId)?.canUndo).toBe(
      false,
    );
    expect((await profileDocs(borrowerCode, 'manager')).find((d) => d.id === docId)?.canUndo).toBe(
      true,
    );
    await http()
      .post(`${base}/undo`)
      .set('Cookie', cookies.other)
      .send({ reason: 'Clicked the wrong button' })
      .expect(403);
    await http()
      .post(`${base}/undo`)
      .set('Cookie', cookies.collections)
      .send({ reason: 'Oops oops' })
      .expect(403);
    await http()
      .post(`${base}/undo`)
      .set('Cookie', cookies.officer)
      .send({ reason: 'x' })
      .expect(400);

    await http()
      .post(`${base}/undo`)
      .set('Cookie', cookies.officer)
      .send({ reason: 'Clicked the wrong button' })
      .expect(200);
    const doc = await prisma.kycDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(doc).toMatchObject({ status: 'PENDING', rejectionReason: null, rejectedById: null });
    const after = (await http().get('/app/documents').set(bearer(token)).expect(200)).body;
    expect(item(after, 'NATIONAL_ID')).toMatchObject({ state: 'PENDING', reason: null });
    const b = await prisma.borrower.findUniqueOrThrow({ where: { code: borrowerCode } });
    expect(
      await prisma.notification.count({
        where: { borrowerId: b.id, title: { startsWith: 'Please ignore our last message' } },
      }),
    ).toBe(1);
    const sms = await prisma.smsMessage.findFirstOrThrow({
      where: { borrowerId: b.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(sms.body).toContain('please ignore our last message');
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'document.review.undo', entityId: docId },
    });
    expect(audit.metadata).toMatchObject({ was: 'REJECTED', reason: 'Clicked the wrong button' });
    // Nothing left to undo now.
    await http()
      .post(`${base}/undo`)
      .set('Cookie', cookies.officer)
      .send({ reason: 'Clicked the wrong button' })
      .expect(409);
  });

  it('undoing an ID check makes identity unverified again; next day only a manager can', async () => {
    const { number, borrowerCode } = await applicant();
    const token = await signInBorrower(number);
    let list = (await upload(token, 'NATIONAL_ID', JPEG, 'id.jpg', 'image/jpeg').expect(201)).body;
    const idDoc = (item(list, 'NATIONAL_ID') as Full).documentId!;
    list = (await upload(token, 'SELFIE', PNG, 'me.png', 'image/png').expect(201)).body;
    const selfieDoc = (item(list, 'SELFIE') as Full).documentId!;
    for (const id of [idDoc, selfieDoc])
      await http()
        .post(`/borrowers/${borrowerCode}/documents/${id}/verify`)
        .set('Cookie', cookies.officer)
        .expect(200);
    expect(
      (await prisma.borrower.findUniqueOrThrow({ where: { code: borrowerCode } })).kycStatus,
    ).toBe('VERIFIED');

    // Pretend the verification happened yesterday.
    await prisma.kycDocument.update({
      where: { id: idDoc },
      data: { verifiedAt: new Date(Date.now() - 36 * 3_600_000) },
    });
    const late = await http()
      .post(`/borrowers/${borrowerCode}/documents/${idDoc}/undo`)
      .set('Cookie', cookies.officer)
      .send({ reason: 'Wrong person on the photo' })
      .expect(403);
    expect(late.body.message).toContain('same day');
    await http()
      .post(`/borrowers/${borrowerCode}/documents/${idDoc}/undo`)
      .set('Cookie', cookies.manager)
      .send({ reason: 'Wrong person on the photo' })
      .expect(200);
    expect(
      (await prisma.borrower.findUniqueOrThrow({ where: { code: borrowerCode } })).kycStatus,
    ).toBe('PENDING');
    list = (await http().get('/app/documents').set(bearer(token)).expect(200)).body;
    expect(item(list, 'NATIONAL_ID').state).toBe('PENDING');
  });

  it('keeps a verification that a loan was later paid out on', async () => {
    const documents = app.get(DocumentsService);
    const manager = { id: randomUUID(), role: 'MANAGER' } as never;
    const verified = {
      borrowerId: randomUUID(),
      status: 'VERIFIED',
      supersededAt: null,
      verifiedAt: new Date(Date.now() - 86_400_000),
      verifiedById: randomUUID(),
      verifiedVia: 'Officer review',
      rejectedAt: null,
      rejectedById: null,
    };
    const withLoan = { loan: { count: async () => 1 } } as never;
    const noLoan = { loan: { count: async () => 0 } } as never;
    expect(await documents.undoBlock(verified, manager, withLoan)).toContain('paid out');
    expect(await documents.undoBlock(verified, manager, noLoan)).toBeNull();
    expect(
      await documents.undoBlock({ ...verified, verifiedVia: 'NIDA' }, manager, noLoan),
    ).toContain('outside the console');
  });
});
