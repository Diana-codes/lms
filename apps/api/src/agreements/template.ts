import {
  annualRateBps,
  COMPONENT_LABELS,
  describePenalty,
  describeRate,
  FEE_TIMING_LABELS,
  FREQUENCY_LABELS,
  formatBps,
  formatDate,
  formatRwf,
  type LoanQuote,
} from '@kora/core';

/**
 * The loan agreement and Key Facts. THIS WORDING IS A DRAFT: it must be
 * reviewed by a Rwandan lawyer, and checked against BNR's consumer
 * protection rules, before any borrower signs it. Change AGREEMENT_VERSION
 * whenever the wording changes; every signed copy keeps its version.
 *
 * The figures come from the same loan engine quote that the loan is paid out
 * on, so the signed copy and the loan always agree.
 *
 * The body is plain text with three markers the PDF renderer understands:
 *   "# "  title     "## " section heading     "| label | value" key fact row
 */
export const AGREEMENT_VERSION = '2026-11-draft-2';

export interface AgreementParties {
  /** The lender's registered name, or its trading name until that is set. */
  lender: string;
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

/** Stored with each signed agreement. Money as digit strings, like the API. */
export interface AgreementTerms {
  version: string;
  productVersion: number | null;
  principal: string;
  fees: Array<{ name: string; total: string; timing: string }>;
  /** Every fee, VAT included. */
  fee: string;
  netDisbursed: string;
  annualRateBps: number;
  rate: string;
  aprBps: number;
  termMonths: number;
  instalments: number;
  frequency: string;
  instalment: string;
  firstDue: string;
  lastDue: string;
  totalInterest: string;
  totalRepayable: string;
  totalCost: string;
  latePayment: string;
  paymentOrder: string;
  earlyRepaymentFeeBps: number;
}

/** The terms to sign, from the quote the loan would be paid out on. */
export function agreementTerms(
  quote: LoanQuote,
  termMonths: number,
  productVersion: number | null,
): AgreementTerms {
  const t = quote.terms;
  return {
    version: AGREEMENT_VERSION,
    productVersion,
    principal: quote.amount.toString(),
    fees: quote.fees.map((f) => ({
      name: f.name,
      total: (f.amount + f.vat).toString(),
      timing: FEE_TIMING_LABELS[f.timing],
    })),
    fee: quote.totalFees.toString(),
    netDisbursed: quote.netDisbursed.toString(),
    annualRateBps: annualRateBps(t),
    rate: describeRate(t),
    aprBps: quote.aprBps,
    termMonths,
    instalments: quote.rows.length,
    frequency: FREQUENCY_LABELS[t.frequency].toLowerCase(),
    instalment: quote.instalment.toString(),
    firstDue: quote.rows[0]!.dueDate,
    lastDue: quote.rows[quote.rows.length - 1]!.dueDate,
    totalInterest: quote.totalInterest.toString(),
    totalRepayable: quote.totalRepayable.toString(),
    totalCost: (quote.totalInterest + quote.totalFees).toString(),
    latePayment: describePenalty(t.penalty),
    paymentOrder: t.allocationOrder.map((c) => COMPONENT_LABELS[c].toLowerCase()).join(', then '),
    earlyRepaymentFeeBps: t.payoff.feeBps,
  };
}

/**
 * True when two sets of terms are the same deal: amount, fees, payout, rate
 * and number of instalments. Due dates (and so, on some products, a few
 * francs of interest) follow the payout day and are not compared.
 */
export function sameFigures(a: AgreementTerms, b: AgreementTerms): boolean {
  return (
    a.principal === b.principal &&
    a.fee === b.fee &&
    a.netDisbursed === b.netDisbursed &&
    a.annualRateBps === b.annualRateBps &&
    a.instalments === b.instalments
  );
}

const rwf = (s: string) => formatRwf(BigInt(s));
const pct = (bps: number) => formatBps(bps, bps % 100 === 0 ? 0 : bps % 10 === 0 ? 1 : 2);

/** The Key Facts as label/value pairs, in the order a borrower should read them. */
export function keyFacts(t: AgreementTerms): Array<[string, string]> {
  return [
    ['Amount borrowed', rwf(t.principal)],
    ...t.fees.map((f): [string, string] => [`${f.name} (${f.timing.toLowerCase()})`, rwf(f.total)]),
    ['You receive', rwf(t.netDisbursed)],
    ['Interest rate', t.rate],
    ['Instalments', `${t.instalments} ${t.frequency} of about ${rwf(t.instalment)}`],
    ['First and last payment', `${formatDate(t.firstDue)} to ${formatDate(t.lastDue)}`],
    ['Total interest', rwf(t.totalInterest)],
    ['Total you repay', rwf(t.totalRepayable)],
    ['Total cost of the loan (interest + fees)', rwf(t.totalCost)],
    ['Annual percentage rate (APR), including fees', pct(t.aprBps)],
    ['If you pay late', t.latePayment],
  ];
}

export function renderAgreement(t: AgreementTerms, p: AgreementParties): string {
  const facts = keyFacts(t)
    .map(([label, value]) => `| ${label} | ${value}`)
    .join('\n');
  const fees = t.fees.length
    ? t.fees.map((f) => `${f.name}: ${rwf(f.total)} (${f.timing.toLowerCase()}).`).join(' ')
    : 'There are no fees on this loan.';
  const early =
    t.earlyRepaymentFeeBps > 0
      ? `An early repayment fee of ${pct(t.earlyRepaymentFeeBps)} of the amount repaid early applies.`
      : 'There is no fee for repaying early.';

  return `# Loan agreement and Key Facts

DRAFT FOR LEGAL REVIEW. Version ${t.version}. Not for use with real borrowers until approved.

Application ${p.applicationCode} · ${p.productName} · ${p.date}

## Key Facts

| Borrower | ${p.borrowerName} (${p.borrowerCode})
${facts}

## 1. The parties

This agreement is between ${p.lender} ("we", "us") and ${p.borrowerName}, customer ${p.borrowerCode}${p.nationalId ? `, national ID ${p.nationalId}` : ''}, phone ${p.phone} ("you").

## 2. The loan

We lend you ${rwf(t.principal)}, and ${rwf(t.netDisbursed)} reaches you. ${fees}

Interest is ${t.rate}. Interest and fees together make the annual percentage rate (APR) ${pct(t.aprBps)}.

## 3. Repaying

You repay in ${t.instalments} ${t.frequency} instalments of about ${rwf(t.instalment)}, from ${formatDate(t.firstDue)} to ${formatDate(t.lastDue)}. The first and last instalments may differ slightly so the loan ends at exactly zero. Your repayment schedule is always in the app and the borrower portal.

You can pay with MTN MoMo from the app, at a branch, or by bank transfer. Each payment pays the oldest instalment first: ${t.paymentOrder}.

You may repay early at any time. Ask us for a settlement figure. ${early}

## 4. Paying late

If you pay late: ${t.latePayment}. Late charges are never charged on late charges. We send you an SMS reminder before each payment is due.

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
