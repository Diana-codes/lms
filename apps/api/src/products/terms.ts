import { InternalServerErrorException } from '@nestjs/common';
import {
  annualRateBps,
  assertTerms,
  instalmentCount,
  type InstalmentLedger,
  type IsoDate,
  isoToUtcDate,
  kigaliDate,
  legacyTerms,
  type LoanQuote,
  type LoanTerms,
  quoteLoan,
  utcDateToIso,
} from '@kora/core';
import type { AccountKey } from '../ledger/accounts';
import { balancedLines, type PostingLine } from '../ledger/posting';

/** A product's terms, checked. Stored terms are validated on write; this guards against corruption. */
export function productTerms(product: { terms: unknown; code?: string }): LoanTerms {
  const terms = product.terms as LoanTerms;
  try {
    assertTerms(terms);
  } catch (err) {
    throw new InternalServerErrorException(
      `Product ${product.code ?? ''} has invalid terms: ${(err as Error).message}`,
    );
  }
  return terms;
}

/** The terms a loan was issued under (older loans: the rules they were built with). */
export function loanTerms(loan: { terms: unknown; annualRateBps: number }): LoanTerms {
  return loan.terms ? (loan.terms as LoanTerms) : legacyTerms(loan.annualRateBps);
}

/**
 * The product's terms at an application's rate. Officers can price an
 * application differently from the product (risk-based pricing); the rest
 * of the product's rules apply unchanged.
 */
export function termsAtRate(terms: LoanTerms, appAnnualRateBps: number): LoanTerms {
  if (annualRateBps(terms) === appAnnualRateBps) return terms;
  return { ...terms, rateBps: appAnnualRateBps, ratePeriod: 'YEAR' };
}

export function quoteFor(input: {
  amount: bigint;
  termMonths: number;
  terms: LoanTerms;
  disbursedOn: IsoDate;
}): LoanQuote {
  return quoteLoan({
    amount: input.amount,
    count: instalmentCount(input.termMonths, input.terms.frequency),
    terms: input.terms,
    disbursedOn: input.disbursedOn,
  });
}

/** The loan an application would become if paid out on `on` (today by default). */
export function applicationQuote(
  app: {
    amount: bigint;
    termMonths: number;
    annualRateBps: number;
    product: { terms: unknown; code?: string };
  },
  on: IsoDate = kigaliDate(),
): LoanQuote {
  return quoteFor({
    amount: app.amount,
    termMonths: app.termMonths,
    terms: termsAtRate(productTerms(app.product), app.annualRateBps),
    disbursedOn: on,
  });
}

/** The loan columns that come from its quote. */
export function loanFieldsFrom(quote: LoanQuote, productVersion: number | null) {
  return {
    principal: quote.principal,
    instalmentAmount: quote.instalment,
    firstDueDate: isoToUtcDate(quote.rows[0]!.dueDate),
    maturityDate: isoToUtcDate(quote.rows[quote.rows.length - 1]!.dueDate),
    terms: quote.terms as object,
    productVersion,
    netDisbursed: quote.netDisbursed,
    aprBps: quote.aprBps,
    spreadFeeTotal: quote.spread.total,
    spreadFeeVat: quote.spread.vat,
    spreadFeeThirdParty: quote.spread.thirdParty,
  };
}

/** Schedule rows to store, each with the day its interest period began. */
export function instalmentRowsFrom(quote: LoanQuote, disbursedOn: IsoDate) {
  return quote.rows.map((row, i) => ({
    number: row.number,
    dueDate: isoToUtcDate(row.dueDate),
    periodStart: isoToUtcDate(i === 0 ? disbursedOn : quote.rows[i - 1]!.dueDate),
    principalDue: row.principal,
    interestDue: row.interest,
    feeDue: row.fee,
  }));
}

/**
 * Disbursing: the receivable is the principal (amount plus financed fees);
 * the cash account pays out the net amount; fees charged now go to income,
 * their VAT to VAT payable, and third-party charges to what is owed on.
 * Fees paid UPFRONT are taken in through the same channel at the same time.
 */
export function disbursementPosting(quote: LoanQuote, cash: AccountKey): PostingLine[] {
  const lines: PostingLine[] = [
    { account: 'LOANS_PRINCIPAL', direction: 'DEBIT', amount: quote.principal },
    { account: cash, direction: 'CREDIT', amount: quote.netDisbursed },
  ];
  for (const fee of quote.fees) {
    if (fee.timing === 'SPREAD') continue;
    if (fee.timing === 'UPFRONT') {
      lines.push({ account: cash, direction: 'DEBIT', amount: fee.amount + fee.vat });
    }
    if (fee.thirdParty) {
      lines.push({
        account: 'THIRD_PARTY_PAYABLE',
        direction: 'CREDIT',
        amount: fee.amount + fee.vat,
      });
    } else {
      lines.push({ account: 'FEE_INCOME', direction: 'CREDIT', amount: fee.amount });
      lines.push({ account: 'VAT_PAYABLE', direction: 'CREDIT', amount: fee.vat });
    }
  }
  return balancedLines(merge(lines));
}

/** Combine lines on the same account and side, so each appears once. */
function merge(lines: PostingLine[]): PostingLine[] {
  const out = new Map<string, PostingLine>();
  for (const l of lines) {
    const key = `${l.account}:${l.direction}`;
    const prev = out.get(key);
    out.set(key, prev ? { ...prev, amount: prev.amount + l.amount } : { ...l });
  }
  return [...out.values()];
}

interface StoredInstalment {
  number: number;
  dueDate: Date;
  periodStart: Date | null;
  principalDue: bigint;
  principalPaid: bigint;
  interestDue: bigint;
  interestPaid: bigint;
  feeDue: bigint;
  feePaid: bigint;
  penaltyDue: bigint;
  penaltyPaid: bigint;
}

/** Stored instalments (in schedule order) as the engine sees them. */
export function toLedger(rows: StoredInstalment[], disbursedOn: Date | null): InstalmentLedger[] {
  return rows.map((r, i) => ({
    number: r.number,
    periodStart: utcDateToIso(
      r.periodStart ?? (i > 0 ? rows[i - 1]!.dueDate : (disbursedOn ?? r.dueDate)),
    ),
    dueDate: utcDateToIso(r.dueDate),
    principalDue: r.principalDue,
    principalPaid: r.principalPaid,
    interestDue: r.interestDue,
    interestPaid: r.interestPaid,
    feeDue: r.feeDue,
    feePaid: r.feePaid,
    penaltyDue: r.penaltyDue,
    penaltyPaid: r.penaltyPaid,
  }));
}
