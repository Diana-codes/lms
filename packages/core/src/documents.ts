import type { IsoDate } from './dates';

/**
 * KYC documents: what each one is called, what file it can be, and how a
 * borrower's uploads add up against what a product requires. Shared by the
 * API, the console and the borrower app so they always agree.
 */
export const DOCUMENT_TYPES = [
  'NATIONAL_ID',
  'SELFIE',
  'BUSINESS_REGISTRATION',
  'FINANCIAL_STATEMENTS',
  'PROOF_OF_ADDRESS',
  'OTHER',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type DocumentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';

export interface DocumentInfo {
  name: string;
  /** One line telling the borrower exactly what to send. */
  hint: string;
  /** Photos only, or a PDF as well. */
  accepts: 'photo' | 'photo-or-pdf';
  /** Which camera to open for a photo. */
  camera: 'front' | 'back';
}

export const DOCUMENT_INFO: Record<DocumentType, DocumentInfo> = {
  NATIONAL_ID: {
    name: 'National ID',
    hint: 'A clear photo of the front of your ID card, with all four corners showing.',
    accepts: 'photo',
    camera: 'back',
  },
  SELFIE: {
    name: 'Selfie',
    hint: 'A photo of your face in good light, without a hat or sunglasses.',
    accepts: 'photo',
    camera: 'front',
  },
  BUSINESS_REGISTRATION: {
    name: 'Business registration (RDB)',
    hint: 'Your RDB certificate of registration, or a clear photo of it.',
    accepts: 'photo-or-pdf',
    camera: 'back',
  },
  FINANCIAL_STATEMENTS: {
    name: 'Bank & MoMo statements',
    hint: 'Statements for the last 6 months, or your latest 3 payslips.',
    accepts: 'photo-or-pdf',
    camera: 'back',
  },
  PROOF_OF_ADDRESS: {
    name: 'Proof of address',
    hint: 'A recent utility bill, lease, or a letter from your umudugudu leader.',
    accepts: 'photo-or-pdf',
    camera: 'back',
  },
  OTHER: {
    name: 'Other document',
    hint: 'Anything else your loan officer asked for.',
    accepts: 'photo-or-pdf',
    camera: 'back',
  },
};

/** Reasons an officer can pick when asking for a new upload. Written for the borrower. */
export const REJECTION_REASONS = [
  'The photo is blurry. Please take it again in good light.',
  'Part of the document is cut off. Please show all four corners.',
  'The name does not match your account.',
  'The document has expired. Please send a current one.',
  'This is not the document we asked for.',
] as const;

export const MAX_REJECTION_REASON = 200;

/** Where a required document stands for this borrower. */
export type ChecklistState =
  | 'MISSING'
  | 'PENDING'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED'
  /** Not needed: bank statements are covered by shared MoMo history. */
  | 'WAIVED';

export interface ChecklistDoc {
  type: DocumentType;
  status: DocumentStatus;
  expiresOn?: IsoDate | null;
  rejectionReason?: string | null;
}

export interface ChecklistItem {
  type: DocumentType;
  state: ChecklistState;
  required: boolean;
  /** Why it was rejected, for the borrower to fix. */
  reason: string | null;
}

export interface Checklist {
  items: ChecklistItem[];
  /** Required documents that are in hand: pending, verified or waived. */
  received: number;
  required: number;
  /** Required documents the borrower still has to send (missing, rejected or expired). */
  needsAction: number;
}

/**
 * Line up a borrower's current documents against a product's requirements.
 * Pass documents oldest first; the latest one of each type counts.
 */
export function documentChecklist(input: {
  required: readonly DocumentType[];
  docs: readonly ChecklistDoc[];
  today: IsoDate;
  /** The borrower shares MoMo history, so statements need not be uploaded. */
  momoHistoryShared?: boolean;
  /** Identity already verified (e.g. with NIDA), so ID and selfie are covered. */
  identityVerified?: boolean;
}): Checklist {
  const latest = new Map<DocumentType, ChecklistDoc>();
  for (const d of input.docs) latest.set(d.type, d);

  const stateOf = (type: DocumentType): ChecklistState => {
    const doc = latest.get(type);
    if (doc) {
      if (doc.status === 'REJECTED') return 'REJECTED';
      if (doc.status === 'EXPIRED' || (doc.expiresOn != null && doc.expiresOn < input.today))
        return 'EXPIRED';
      if (doc.status === 'VERIFIED') return 'VERIFIED';
      return 'PENDING';
    }
    if (input.identityVerified && (type === 'NATIONAL_ID' || type === 'SELFIE')) return 'VERIFIED';
    if (input.momoHistoryShared && type === 'FINANCIAL_STATEMENTS') return 'WAIVED';
    return 'MISSING';
  };

  const required = [...new Set(input.required)];
  const items: ChecklistItem[] = required.map((type) => ({
    type,
    state: stateOf(type),
    required: true,
    reason:
      latest.get(type)?.status === 'REJECTED' ? (latest.get(type)?.rejectionReason ?? null) : null,
  }));
  // Anything else the borrower has sent shows too, after the required ones.
  for (const type of DOCUMENT_TYPES) {
    if (required.includes(type) || !latest.has(type)) continue;
    const doc = latest.get(type)!;
    items.push({
      type,
      state: stateOf(type),
      required: false,
      reason: doc.status === 'REJECTED' ? (doc.rejectionReason ?? null) : null,
    });
  }

  const req = items.filter((i) => i.required);
  return {
    items,
    received: req.filter((i) => ['PENDING', 'VERIFIED', 'WAIVED'].includes(i.state)).length,
    required: req.length,
    needsAction: req.filter((i) => ['MISSING', 'REJECTED', 'EXPIRED'].includes(i.state)).length,
  };
}
