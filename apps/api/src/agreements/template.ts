import {
  costOfCredit,
  formatBps,
  formatRwf,
  PENALTY_PERIOD_DAYS,
  type CostOfCredit,
} from '@kora/core';

/**
 * The loan agreement and Key Facts. THIS WORDING IS A DRAFT: it must be
 * reviewed by a Rwandan lawyer, and checked against BNR's consumer
 * protection rules, before any borrower signs it. Change AGREEMENT_VERSION
 * whenever the wording changes; every signed copy keeps its version.
 *
 * The body is plain text with three markers the PDF renderer understands:
 *   "# "  title     "## " section heading     "| label | value" key fact row
 */
export const AGREEMENT_VERSION = '2026-11-draft-1';

/** Placeholder until the real company details are known. */
const LENDER = 'Kora Lend Ltd [registered name, RDB company code and BNR licence number]';

export interface AgreementParties {
  borrowerName: string;
  borrowerCode: string;
  /** Masked, e.g. "1 •••• ••••••• ••312". */
  nationalId: string | null;
  phone: string;
  applicationCode: string;
  productName: string;
  /** Kigali date the terms were shown, e.g. "17 Nov 2026". */
  date: string;
}

export interface AgreementTermsInput {
  principal: bigint;
  annualRateBps: number;
  termMonths: number;
  feeBps: number;
  latePenaltyBps: number;
  penaltyGraceDays: number;
}

/** Stored with each signed agreement. Money as digit strings, like the API. */
export interface AgreementTerms {
  version: string;
  principal: string;
  feeBps: number;
  fee: string;
  netDisbursed: string;
  annualRateBps: number;
  aprBps: number;
  termMonths: number;
  instalment: string;
  totalInterest: string;
  totalRepayable: string;
  totalCost: string;
  latePenaltyBps: number;
  penaltyGraceDays: number;
}

export function agreementTerms(input: AgreementTermsInput): AgreementTerms {
  const c: CostOfCredit = costOfCredit({
    principal: input.principal,
    annualRateBps: input.annualRateBps,
    termMonths: input.termMonths,
    feeBps: input.feeBps,
  });
  return {
    version: AGREEMENT_VERSION,
    principal: c.principal.toString(),
    feeBps: input.feeBps,
    fee: c.fee.toString(),
    netDisbursed: c.netDisbursed.toString(),
    annualRateBps: input.annualRateBps,
    aprBps: c.aprBps,
    termMonths: input.termMonths,
    instalment: c.instalment.toString(),
    totalInterest: c.totalInterest.toString(),
    totalRepayable: c.totalRepayable.toString(),
    totalCost: c.totalCost.toString(),
    latePenaltyBps: input.latePenaltyBps,
    penaltyGraceDays: input.penaltyGraceDays,
  };
}

const rwf = (s: string) => formatRwf(BigInt(s));
const pct = (bps: number) => formatBps(bps, bps % 100 === 0 ? 0 : bps % 10 === 0 ? 1 : 2);

/** The Key Facts as label/value pairs, in the order a borrower should read them. */
export function keyFacts(t: AgreementTerms): Array<[string, string]> {
  return [
    ['Amount borrowed', rwf(t.principal)],
    [`Fee (${pct(t.feeBps)}, taken from the payout)`, rwf(t.fee)],
    ['You receive in your MoMo wallet', rwf(t.netDisbursed)],
    ['Interest rate', `${pct(t.annualRateBps)} a year, on the reducing balance`],
    ['Monthly instalment', `${rwf(t.instalment)} × ${t.termMonths} months`],
    ['Total interest', rwf(t.totalInterest)],
    ['Total you repay', rwf(t.totalRepayable)],
    ['Total cost of the loan (interest + fee)', rwf(t.totalCost)],
    ['Annual percentage rate (APR), including fees', pct(t.aprBps)],
    [
      'If you pay late',
      t.latePenaltyBps > 0
        ? `${pct(t.latePenaltyBps)} of the overdue amount after ${t.penaltyGraceDays} days, then every ${PENALTY_PERIOD_DAYS} days it stays unpaid`
        : 'No late penalty',
    ],
  ];
}

export function renderAgreement(t: AgreementTerms, p: AgreementParties): string {
  const facts = keyFacts(t)
    .map(([label, value]) => `| ${label} | ${value}`)
    .join('\n');
  const penalty =
    t.latePenaltyBps > 0
      ? `If an instalment is not fully paid ${t.penaltyGraceDays} days after its due date, a late penalty of ${pct(t.latePenaltyBps)} of the unpaid principal and interest on that instalment is added. It is added again every ${PENALTY_PERIOD_DAYS} days while the instalment stays unpaid. Penalties are never charged on penalties. We send you an SMS reminder before each payment is due, and the app shows any penalty as soon as it is added.`
      : 'There is no late penalty on this loan.';

  return `# Loan agreement and Key Facts

DRAFT FOR LEGAL REVIEW. Version ${t.version}. Not for use with real borrowers until approved.

Application ${p.applicationCode} · ${p.productName} · ${p.date}

## Key Facts

| Borrower | ${p.borrowerName} (${p.borrowerCode})
${facts}

## 1. The parties

This agreement is between ${LENDER} ("we", "us") and ${p.borrowerName}, customer ${p.borrowerCode}${p.nationalId ? `, national ID ${p.nationalId}` : ''}, phone ${p.phone} ("you").

## 2. The loan

We lend you ${rwf(t.principal)}. A fee of ${rwf(t.fee)} (${pct(t.feeBps)}) is taken from the amount we send, so ${rwf(t.netDisbursed)} reaches your MoMo wallet. You repay the full ${rwf(t.principal)} plus interest.

Interest is ${pct(t.annualRateBps)} a year, charged monthly on the amount you still owe (reducing balance). The fee and interest together make the annual percentage rate (APR) ${pct(t.aprBps)}.

## 3. Repaying

You repay in ${t.termMonths} monthly instalments of ${rwf(t.instalment)}. The first is due one month after the money is sent, and the rest on the same day of each following month. The last instalment may differ by a few francs so the loan ends at exactly zero. Your repayment schedule is always in the Kora Lend app.

You can pay with MTN MoMo from the app, at a branch, or by bank transfer. Each payment pays any late penalty first, then interest, then the loan amount, starting with the oldest instalment.

You may repay early at any time. Ask us for a settlement figure.

## 4. Paying late

${penalty}

If you cannot pay, contact us as soon as you can. We may agree a new plan with you, such as a longer term or a payment holiday. Missed payments may be reported to the credit bureau if you agreed to that when you applied.

## 5. Your data

We use your information only to manage this loan, as you agreed when you applied, under Law Nº 058/2021 on the protection of personal data and privacy. You can see the consents you gave, and withdraw optional ones, in the app.

## 6. Questions and complaints

Contact your loan officer, call or visit your branch, or use Support in the app. If we do not resolve your complaint, you may contact the National Bank of Rwanda.

## 7. The law

This agreement is governed by the laws of Rwanda.

## Acceptance

By accepting in the app, or by signing at a branch, you confirm that you have read the Key Facts and this agreement and that you agree to them.
`;
}
