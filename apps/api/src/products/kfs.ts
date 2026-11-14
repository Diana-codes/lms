import {
  annualRateBps,
  describePenalty,
  FREQUENCY_LABELS,
  type IsoDate,
  type LoanQuote,
} from '@kora/core';

/** BNR's channels for escalating a complaint (Regulation 91/2025, Annex I, Section IV). */
export const BNR_ESCALATION = {
  chatbot: 'INTUMWA chatbot on the BNR website',
  sms: '6005',
  whatsapp: '+250 791 700 721',
};

export interface KfsParty {
  lender: {
    name: string;
    legalName: string | null;
    supportPhone: string | null;
    supportEmail: string | null;
    address: string | null;
  };
  borrowerName: string;
  reference: string;
  /** The loan's collateral, if any. */
  collateral: string | null;
  /** False before disbursement, when collateral is still to be agreed. */
  collateralKnown: boolean;
}

/**
 * The Key Facts Statement for a loan, in the order and with the items of
 * BNR Regulation 91/2025 Annex I. Money as bigint; the API serialises it.
 */
export function keyFactsStatement(
  quote: LoanQuote,
  termMonths: number,
  party: KfsParty,
  preparedOn: IsoDate,
) {
  const t = quote.terms;
  const fees = quote.fees.map((f) => ({
    name: f.name,
    amount: f.amount,
    vat: f.vat,
    total: f.amount + f.vat,
    thirdParty: f.thirdParty,
    timing: f.timing,
  }));
  const upfront = fees.filter((f) => f.timing !== 'SPREAD');
  const recurring = fees
    .filter((f) => f.timing === 'SPREAD')
    .map((f) => ({ ...f, perInstalment: f.total / BigInt(quote.rows.length) }));
  // Item 8/14: every cost of the loan, interest and all fees (third-party
  // included); the APR alone leaves third-party costs out.
  const totalCost = quote.totalInterest + quote.totalFees;

  return {
    preparedOn,
    reference: party.reference,
    lender: party.lender,
    borrowerName: party.borrowerName,
    summary: {
      amount: quote.amount,
      collateral: party.collateral,
      collateralKnown: party.collateralKnown,
      durationMonths: termMonths,
      amountReceived: quote.netDisbursed,
    },
    cost: {
      nominalAnnualRateBps: annualRateBps(t),
      quotedRateBps: t.rateBps,
      quotedPer: t.ratePeriod,
      interestMethod: t.interestMethod,
      totalInterest: quote.totalInterest,
      otherFees: quote.totalFees,
      totalCost,
      /** Included in the total cost, left out of the APR. */
      thirdParty: quote.totalThirdParty,
      aprBps: quote.aprBps,
    },
    repayment: {
      instalments: quote.rows.length,
      frequency: FREQUENCY_LABELS[t.frequency],
      instalmentAmount: quote.instalment,
      totalToPay: quote.amount + totalCost,
      firstDue: quote.rows[0]!.dueDate,
      lastDue: quote.rows[quote.rows.length - 1]!.dueDate,
    },
    fees: { upfront, recurring, total: quote.totalFees },
    conditions: {
      latePayment: describePenalty(t.penalty),
      earlyRepaymentFeeBps: t.payoff.feeBps,
      variableRate: false,
    },
    escalation: BNR_ESCALATION,
    schedule: quote.rows,
  };
}

export type KeyFacts = ReturnType<typeof keyFactsStatement>;
