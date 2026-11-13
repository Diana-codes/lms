/** What the app needs from a mobile-money provider. MTN MoMo and the local simulator both fit. */
export type MomoStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED';

export interface MomoResult {
  status: MomoStatus;
  /** The provider's own transaction ID, present once it succeeds. */
  financialTransactionId?: string;
  reason?: string;
}

export interface MomoRequest {
  /** Our reference (a UUID). The same reference is never sent twice. */
  referenceId: string;
  amount: bigint;
  /** E.164 without the plus is what MTN expects; pass the stored +250… form. */
  phone: string;
  /** Shown in our records at MTN, e.g. the loan number. */
  externalId: string;
  message: string;
}

export abstract class MomoGateway {
  abstract readonly name: 'mtn' | 'simulator';
  /** Ask a borrower to approve a payment on their phone (Collections). */
  abstract requestToPay(request: MomoRequest): Promise<void>;
  abstract requestToPayStatus(referenceId: string): Promise<MomoResult>;
  /** Send money to a borrower (Disbursements). */
  abstract transfer(request: MomoRequest): Promise<void>;
  abstract transferStatus(referenceId: string): Promise<MomoResult>;
}

export class MomoError extends Error {}
