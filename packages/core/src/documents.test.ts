import { describe, expect, it } from 'vitest';
import { DOCUMENT_INFO, DOCUMENT_TYPES, documentChecklist } from './documents';

const today = '2026-11-17';

describe('documentChecklist', () => {
  it('lists every required document as missing when nothing has been sent', () => {
    const c = documentChecklist({
      required: ['NATIONAL_ID', 'SELFIE', 'BUSINESS_REGISTRATION'],
      docs: [],
      today,
    });
    expect(c.items.map((i) => i.state)).toEqual(['MISSING', 'MISSING', 'MISSING']);
    expect(c).toMatchObject({ received: 0, required: 3, needsAction: 3 });
  });

  it('uses the latest upload of each type, so a re-upload replaces a rejection', () => {
    const c = documentChecklist({
      required: ['NATIONAL_ID'],
      docs: [
        { type: 'NATIONAL_ID', status: 'REJECTED', rejectionReason: 'Blurry' },
        { type: 'NATIONAL_ID', status: 'PENDING' },
      ],
      today,
    });
    expect(c.items[0]).toMatchObject({ state: 'PENDING', reason: null });
    expect(c).toMatchObject({ received: 1, needsAction: 0 });
  });

  it('passes the rejection reason on to the borrower', () => {
    const c = documentChecklist({
      required: ['SELFIE'],
      docs: [{ type: 'SELFIE', status: 'REJECTED', rejectionReason: 'Blurry' }],
      today,
    });
    expect(c.items[0]).toMatchObject({ state: 'REJECTED', reason: 'Blurry' });
    expect(c.needsAction).toBe(1);
  });

  it('treats a document past its expiry date as expired', () => {
    const c = documentChecklist({
      required: ['PROOF_OF_ADDRESS'],
      docs: [{ type: 'PROOF_OF_ADDRESS', status: 'VERIFIED', expiresOn: '2026-11-16' }],
      today,
    });
    expect(c.items[0]!.state).toBe('EXPIRED');
    expect(c.needsAction).toBe(1);
  });

  it('waives statements when MoMo history is shared, and ID when identity is verified', () => {
    const c = documentChecklist({
      required: ['NATIONAL_ID', 'SELFIE', 'FINANCIAL_STATEMENTS'],
      docs: [],
      today,
      momoHistoryShared: true,
      identityVerified: true,
    });
    expect(c.items.map((i) => i.state)).toEqual(['VERIFIED', 'VERIFIED', 'WAIVED']);
    expect(c).toMatchObject({ received: 3, needsAction: 0 });
  });

  it('shows extra documents after the required ones without counting them', () => {
    const c = documentChecklist({
      required: ['NATIONAL_ID'],
      docs: [
        { type: 'OTHER', status: 'PENDING' },
        { type: 'NATIONAL_ID', status: 'VERIFIED' },
      ],
      today,
    });
    expect(c.items.map((i) => [i.type, i.required])).toEqual([
      ['NATIONAL_ID', true],
      ['OTHER', false],
    ]);
    expect(c.required).toBe(1);
  });

  it('only lets ID and selfie be photos', () => {
    for (const t of DOCUMENT_TYPES) {
      expect(DOCUMENT_INFO[t].accepts).toBe(
        t === 'NATIONAL_ID' || t === 'SELFIE' ? 'photo' : 'photo-or-pdf',
      );
    }
  });
});
