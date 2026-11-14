import {
  formatBps,
  formatDate,
  formatRwf,
  INTEREST_METHOD_LABELS,
  type InterestMethod,
} from '@kora/core';
import type { ReactNode } from 'react';

/** GET /applications/:code/key-facts and /loans/:code/key-facts. Money as digit strings. */
export interface KeyFacts {
  preparedOn: string;
  reference: string;
  lender: {
    name: string;
    legalName: string | null;
    supportPhone: string | null;
    supportEmail: string | null;
    address: string | null;
  };
  borrowerName: string;
  summary: {
    amount: string;
    collateral: string | null;
    collateralKnown: boolean;
    durationMonths: number;
    amountReceived: string;
  };
  cost: {
    nominalAnnualRateBps: number;
    quotedRateBps: number;
    quotedPer: 'YEAR' | 'MONTH';
    interestMethod: InterestMethod;
    totalInterest: string;
    otherFees: string;
    totalCost: string;
    thirdParty: string;
    aprBps: number;
  };
  repayment: {
    instalments: number;
    frequency: string;
    instalmentAmount: string;
    totalToPay: string;
    firstDue: string;
    lastDue: string;
  };
  fees: {
    upfront: Array<{
      name: string;
      amount: string;
      vat: string;
      total: string;
      thirdParty: boolean;
    }>;
    recurring: Array<{ name: string; total: string; perInstalment: string; thirdParty: boolean }>;
    total: string;
  };
  conditions: { latePayment: string; earlyRepaymentFeeBps: number; variableRate: boolean };
  escalation: { chatbot: string; sms: string; whatsapp: string };
}

const rwf = (s: string) => formatRwf(BigInt(s));
const pct = (bps: number) => formatBps(bps, bps % 100 ? 2 : 0);

function Item({
  n,
  label,
  hint,
  children,
}: {
  n: number;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-soft py-2.5">
      <div className="flex flex-col">
        <span className="font-semibold">
          {n}. {label}
        </span>
        {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
      </div>
      <span className="text-right font-semibold tabular-nums">{children}</span>
    </div>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col">
      <h3 className="m-0 mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * The Key Facts Statement for credit, following BNR Regulation 91/2025
 * Annex I: key terms, fees, conditions, rights and signatures.
 */
export function KeyFactsDocument({ kfs }: { kfs: KeyFacts }) {
  const { lender } = kfs;
  const contact = [lender.supportPhone, lender.supportEmail, lender.address]
    .filter(Boolean)
    .join(' · ');
  return (
    <article className="flex min-w-0 flex-col gap-6 rounded-card border border-line bg-surface p-5 text-sm md:p-8 print:border-0 print:p-0">
      <header className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-[24px] leading-tight font-semibold">
          Key Facts Statement for credit
        </h1>
        <p className="m-0 text-ink-muted">
          This information is not final until signed by all parties and does not replace the loan
          agreement. Read carefully before agreeing to a loan and signing a loan agreement.
        </p>
        <dl className="m-0 grid gap-x-6 gap-y-1 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-muted">Lender</dt>
            <dd className="m-0 font-semibold">{lender.legalName ?? lender.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Borrower</dt>
            <dd className="m-0 font-semibold">{kfs.borrowerName}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Date prepared · reference</dt>
            <dd className="m-0 font-semibold">
              {formatDate(kfs.preparedOn)} · {kfs.reference}
            </dd>
          </div>
        </dl>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 font-display text-base font-semibold">Section I: Key terms</h2>
        <div className="grid gap-6 lg:grid-cols-3">
          <Column title="Loan summary">
            <Item n={1} label="Amount of loan" hint="Amount you are borrowing">
              {rwf(kfs.summary.amount)}
            </Item>
            <Item n={2} label="Is collateral required?">
              {kfs.summary.collateral
                ? `Yes: ${kfs.summary.collateral}`
                : kfs.summary.collateralKnown
                  ? 'No'
                  : 'As set out in the agreement'}
            </Item>
            <Item n={3} label="Duration">
              {kfs.summary.durationMonths} months
            </Item>
            <Item n={4} label="Amount you will receive">
              {rwf(kfs.summary.amountReceived)}
            </Item>
          </Column>
          <Column title="Cost of credit">
            <Item
              n={5}
              label="Nominal interest rate per year"
              hint={`${INTEREST_METHOD_LABELS[kfs.cost.interestMethod]}${
                kfs.cost.quotedPer === 'MONTH' ? ` (${pct(kfs.cost.quotedRateBps)} a month)` : ''
              }`}
            >
              {pct(kfs.cost.nominalAnnualRateBps)}
            </Item>
            <Item n={6} label="Total interest" hint="Charged on the entire loan">
              {rwf(kfs.cost.totalInterest)}
            </Item>
            <Item n={7} label="Other fees and charges" hint="Details in Section II">
              {rwf(kfs.cost.otherFees)}
            </Item>
            <Item n={8} label="Total cost of credit" hint="All costs, including interest and fees">
              {rwf(kfs.cost.totalCost)}
            </Item>
            <Item n={9} label="Annual percentage rate (APR)" hint="Interest and all known fees">
              {formatBps(kfs.cost.aprBps, 2)}
            </Item>
          </Column>
          <Column title="Repayment schedule">
            <Item n={10} label="Number of instalments">
              {kfs.repayment.instalments}
            </Item>
            <Item n={11} label="Payment frequency">
              {kfs.repayment.frequency}
            </Item>
            <Item n={12} label="Repayment amount" hint="Capital, interest and recurring fees">
              {rwf(kfs.repayment.instalmentAmount)}
            </Item>
          </Column>
        </div>
        <div className="grid gap-x-6 rounded-control bg-ground px-4 lg:grid-cols-3">
          <Item n={13} label="Amount of loan" hint="Amount you are borrowing">
            {rwf(kfs.summary.amount)}
          </Item>
          <Item n={14} label="Total cost of credit" hint="All costs, including interest and fees">
            {rwf(kfs.cost.totalCost)}
          </Item>
          <Item n={15} label="Total amount you will pay" hint="After making all payments">
            {rwf(kfs.repayment.totalToPay)}
          </Item>
        </div>
        <p className="m-0 text-xs text-ink-muted">
          First payment {formatDate(kfs.repayment.firstDue)}, last{' '}
          {formatDate(kfs.repayment.lastDue)}. The APR includes interest, fees and other charges,
          but not third-party costs such as insurance or collateral registration that go directly to
          third parties
          {kfs.cost.thirdParty !== '0'
            ? `; the total cost and the total you will pay include ${rwf(kfs.cost.thirdParty)} of them`
            : ''}
          .
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 font-display text-base font-semibold">
          Section II: Upfront and recurring fees
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <Column title="Upfront fees">
            {kfs.fees.upfront.length === 0 ? <p className="m-0 py-2.5">None</p> : null}
            {kfs.fees.upfront.map((f) => (
              <div
                key={f.name}
                className="flex justify-between gap-4 border-b border-line-soft py-2.5"
              >
                <span>
                  {f.name}
                  {f.vat !== '0' ? (
                    <span className="text-ink-muted"> (incl. VAT {rwf(f.vat)})</span>
                  ) : null}
                  {f.thirdParty ? (
                    <span className="text-ink-muted"> · paid to a third party</span>
                  ) : null}
                </span>
                <span className="font-semibold tabular-nums">{rwf(f.total)}</span>
              </div>
            ))}
          </Column>
          <Column title="Recurring fees">
            {kfs.fees.recurring.length === 0 ? <p className="m-0 py-2.5">None</p> : null}
            {kfs.fees.recurring.map((f) => (
              <div
                key={f.name}
                className="flex justify-between gap-4 border-b border-line-soft py-2.5"
              >
                <span>
                  {f.name}
                  {f.thirdParty ? (
                    <span className="text-ink-muted"> · paid to a third party</span>
                  ) : null}
                </span>
                <span className="font-semibold tabular-nums">
                  {rwf(f.perInstalment)} per instalment
                </span>
              </div>
            ))}
          </Column>
        </div>
        <div className="flex justify-between gap-4 font-semibold">
          <span>Total upfront and recurring fees and charges, excluding interest</span>
          <span className="tabular-nums">{rwf(kfs.fees.total)}</span>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="m-0 font-display text-base font-semibold">
          Section III: Important terms and conditions
        </h2>
        <div className="flex justify-between gap-4 border-b border-line-soft py-2">
          <span>Late payment penalty</span>
          <span className="text-right font-semibold">{kfs.conditions.latePayment}</span>
        </div>
        <div className="flex justify-between gap-4 border-b border-line-soft py-2">
          <span>Early repayment (loan takeover) penalty</span>
          <span className="font-semibold">
            {kfs.conditions.earlyRepaymentFeeBps
              ? pct(kfs.conditions.earlyRepaymentFeeBps)
              : 'None'}
          </span>
        </div>
        <div className="flex justify-between gap-4 border-b border-line-soft py-2">
          <span>Interest rate</span>
          <span className="font-semibold">Fixed for the life of the loan</span>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="m-0 font-display text-base font-semibold">
          Section IV: Your rights and obligations
        </h2>
        <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5">
          <li>You can track the status of your application where you submitted it.</li>
          <li>
            Questions or complaints: contact {lender.name}
            {contact ? ` at ${contact}` : ''}.
          </li>
          <li>
            Not satisfied with our answer? Escalate to BNR through the {kfs.escalation.chatbot}, by
            SMS to {kfs.escalation.sms}, or on WhatsApp at {kfs.escalation.whatsapp}.
          </li>
          <li>
            You can pay off your loan early
            {kfs.conditions.earlyRepaymentFeeBps
              ? `; an early repayment fee of ${pct(kfs.conditions.earlyRepaymentFeeBps)} applies.`
              : ' without any penalties or fees.'}
          </li>
          <li>
            You have the right to a loan agreement, and to ask for more information about this loan.
          </li>
          <li>
            You may choose any official language of Rwanda for the loan agreement and related
            documents.
          </li>
          <li>
            Up to 30 working days after signing but before the money is paid out, you may cancel the
            loan by written notice, paying only the service fees for reviewing your file and
            preparing the contract.
          </li>
          <li>You may ask to restructure your loan under BNR rules and our policies.</li>
          <li>
            The APR shows the yearly cost of this credit; use it to compare loans from different
            lenders.
          </li>
          <li>
            Repaying on time and in full is your responsibility. Late or missed payments can affect
            your collateral and your credit history.
          </li>
        </ol>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="m-0 font-display text-base font-semibold">Section V: Required documents</h2>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="border-b border-line pb-1 text-ink-muted">
              {n}.
            </div>
          ))}
        </div>
      </section>

      <footer className="grid gap-8 pt-4 sm:grid-cols-2">
        <div className="flex flex-col gap-6">
          <span className="text-xs font-semibold uppercase">Certified documents correct</span>
          <span className="border-b border-ink pb-1 text-xs text-ink-muted">
            Lender&apos;s representative: name and signature
          </span>
          <span className="border-b border-ink pb-1 text-xs text-ink-muted">Date</span>
        </div>
        <div className="flex flex-col gap-6">
          <span className="text-xs font-semibold uppercase">
            I acknowledge receipt of this statement
          </span>
          <span className="border-b border-ink pb-1 text-xs text-ink-muted">
            Borrower: name and signature
          </span>
          <span className="border-b border-ink pb-1 text-xs text-ink-muted">Date</span>
        </div>
      </footer>
    </article>
  );
}
