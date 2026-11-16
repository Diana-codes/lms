'use client';

import {
  CASHFLOW_CATEGORIES,
  CASHFLOW_CATEGORY_LABELS,
  type CashflowCategory,
  formatDate,
  formatRwf,
} from '@kora/core';
import {
  AiBadge,
  AiPanel,
  Button,
  Card,
  CardTitle,
  FormError,
  Modal,
  Money,
  Pill,
  SelectField,
  Table,
  Td,
  TextAreaField,
  TextField,
  Th,
  useToast,
} from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { dateTime, groupDigits } from '@/lib/format';
import type { CashflowView, Figure } from './types';

const message = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
const KIND_LABEL = {
  PAYSLIP: 'Payslip',
  BANK_STATEMENT: 'Bank statement',
  MOMO_STATEMENT: 'Mobile money statement',
} as const;
const CONFIDENCE_TONE = { HIGH: 'success', MEDIUM: 'info', LOW: 'warning' } as const;
const SEVERITY_TONE = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'neutral' } as const;
const pct = (bps: number) => `${Math.round(bps / 100)}%`;

export function CashflowWorkspace({ view, canEdit }: { view: CashflowView; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ label: string; ids: Set<string> } | null>(null);
  const a = view.analysis;
  const open = a?.status === 'READY_FOR_REVIEW';
  const code = view.application.code;

  async function run(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      toast(done);
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  const show = (label: string, f: Figure | string[]) =>
    setFocus({ label, ids: new Set(Array.isArray(f) ? f : f.sources) });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Card className="gap-3">
          <CardTitle>Documents</CardTitle>
          {view.documents.length === 0 ? (
            <p className="m-0 text-sm text-ink-muted">
              Upload payslips and the last 3–6 months of bank or mobile money statements. CSV
              exports are read directly
              {view.aiAvailable
                ? '; PDFs and photos are read by AI.'
                : '. PDFs and photos need AI assistance, which is off.'}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {view.documents.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-col gap-0.5 rounded-control border border-line p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{KIND_LABEL[d.kind]}</span>
                    <span className="text-ink-muted">{d.fileName}</span>
                    <Pill
                      tone={
                        d.status === 'READ'
                          ? 'success'
                          : d.status === 'UNREADABLE'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {d.status === 'READ'
                        ? 'Read'
                        : d.status === 'UNREADABLE'
                          ? 'Manual review'
                          : 'Not read yet'}
                    </Pill>
                    {d.extractor && d.extractor !== 'csv-v1' ? <AiBadge>Read by AI</AiBadge> : null}
                  </div>
                  {d.holderName ? (
                    <span className="text-xs text-ink-muted">Name on document: {d.holderName}</span>
                  ) : null}
                  {d.payslip?.net ? (
                    <span className="text-xs text-ink-muted">
                      Payslip {d.payslip.payPeriod ?? ''}: net {formatRwf(BigInt(d.payslip.net))}
                      {d.payslip.employer ? ` · ${d.payslip.employer}` : ''}
                    </span>
                  ) : null}
                  {d.error ? <span className="text-xs text-warning-fg">{d.error}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {canEdit && a?.status !== 'REVIEWED' ? <UploadDocument code={code} /> : null}
        </Card>

        <Card className="gap-3">
          <CardTitle>Consent and analysis</CardTitle>
          {view.consent ? (
            <p className="m-0 text-sm">
              Borrower consented to automated analysis on {dateTime(view.consent.grantedAt)} (
              {view.consent.channel === 'APP' ? 'in the app' : 'recorded by staff'}).
            </p>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <p className="m-0 text-ink-muted">
                Before analysing, tell the borrower their documents are read automatically to
                summarise income, that a staff member makes the decision, and that they can ask for
                a review by a person instead.
              </p>
              {canEdit ? (
                <Button
                  variant="secondary"
                  className="self-start"
                  loading={busy === 'consent'}
                  onClick={() =>
                    run(
                      'consent',
                      () => api(`/applications/${code}/cashflow/consent`, { method: 'POST' }),
                      'Consent recorded.',
                    )
                  }
                >
                  The borrower has agreed
                </Button>
              ) : null}
            </div>
          )}
          {canEdit && a?.status !== 'REVIEWED' ? (
            <Button
              className="self-start"
              loading={busy === 'analyse'}
              disabled={!view.consent || view.documents.length === 0}
              onClick={() =>
                run(
                  'analyse',
                  () => api(`/applications/${code}/cashflow/analyse`, { method: 'POST' }),
                  'Analysis ready for review.',
                )
              }
            >
              {a ? 'Run the analysis again' : 'Analyse documents'}
            </Button>
          ) : null}
          {a ? (
            <p className="m-0 text-xs text-ink-muted">
              {a.status === 'REVIEWED'
                ? `Reviewed ${a.reviewedAt ? dateTime(a.reviewedAt) : ''}.`
                : a.status === 'FAILED'
                  ? a.error
                  : 'Ready for review.'}{' '}
              Rules {a.modelVersion}, run {dateTime(a.createdAt)}.
            </p>
          ) : null}
          <FormError>{error}</FormError>
        </Card>
      </div>

      {a?.report && a.status !== 'FAILED' ? (
        <>
          <AiPanel
            title="Cash-flow summary"
            meta={
              <Pill tone={CONFIDENCE_TONE[a.report.averageIncome.confidence]}>
                {a.report.averageIncome.confidence.toLowerCase()} confidence
              </Pill>
            }
          >
            <p className="m-0">{a.report.summary}</p>
            <p className="m-0 mt-2 text-xs text-ink-muted">
              Advice for the analyst. It does not approve, decline or price the loan, and the
              borrower does not see it.
            </p>
          </AiPanel>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <FigureTile label="Average monthly income" f={a.report.averageIncome} onShow={show} />
            <FigureTile
              label="Regular commitments"
              f={a.report.recurringCommitments}
              onShow={show}
            />
            <FigureTile
              label="Other loan repayments"
              f={a.report.existingDebtRepayments}
              onShow={show}
            />
            <FigureTile label="Left each month" f={a.report.netDisposable} onShow={show} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card className="gap-3">
              <CardTitle>Month by month</CardTitle>
              <Table minWidth={420}>
                <thead>
                  <tr>
                    <Th>Month</Th>
                    <Th numeric>Income</Th>
                    <Th numeric>Money out</Th>
                  </tr>
                </thead>
                <tbody>
                  {a.report.months.map((m) => (
                    <tr key={m.month}>
                      <Td>{formatDate(`${m.month}-01`).replace(/^1 /, '')}</Td>
                      <Td numeric>
                        <Money amount={m.income} bare />
                      </Td>
                      <Td numeric className="font-normal">
                        <Money amount={m.outflow} bare />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="m-0 text-xs text-ink-muted">
                Lowest full month <Money amount={a.report.lowestMonthIncome} />, highest{' '}
                <Money amount={a.report.highestMonthIncome} />; variation{' '}
                {pct(a.report.variationBps)}. Income in {a.report.monthsWithIncome} of{' '}
                {a.report.months.length} months.
              </p>
            </Card>
            <Card className="gap-3">
              <CardTitle>Affordability</CardTitle>
              <p className="m-0 font-display text-2xl font-semibold tabular-nums">
                {formatRwf(BigInt(a.report.affordable.low))} –{' '}
                {formatRwf(BigInt(a.report.affordable.high))}
              </p>
              <p className="m-0 text-sm text-ink-muted">
                A new monthly instalment in this range stays within the product’s{' '}
                {pct(a.report.affordable.dsrBps)} debt-service limit after other loans.
              </p>
              <CardTitle>Income by source</CardTitle>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
                {a.report.incomeBySource.map((s) => (
                  <li key={s.category} className="flex justify-between gap-3">
                    <button
                      type="button"
                      className="cursor-pointer border-0 bg-transparent p-0 text-left text-forest underline"
                      onClick={() =>
                        setFocus({
                          label: CASHFLOW_CATEGORY_LABELS[s.category],
                          ids: new Set(
                            a.transactions
                              .filter((t) => t.category === s.category)
                              .map((t) => t.id),
                          ),
                        })
                      }
                    >
                      {CASHFLOW_CATEGORY_LABELS[s.category]}
                    </button>
                    <span className="tabular-nums">
                      <Money amount={s.total} bare /> · {pct(s.shareBps)}
                    </span>
                  </li>
                ))}
              </ul>
              {a.report.payslipNet ? (
                <p className="m-0 text-sm">
                  Payslip net pay <Money amount={a.report.payslipNet} />
                  {a.report.salaryCredits ? (
                    <>
                      ; salary received <Money amount={a.report.salaryCredits} />
                    </>
                  ) : null}
                  .
                </p>
              ) : null}
            </Card>
          </div>

          <Flags analysis={a} canEdit={canEdit && open} onShow={show} />
          <Transactions
            analysis={a}
            canEdit={canEdit && open}
            focus={focus}
            onClear={() => setFocus(null)}
          />
          <Review view={view} canEdit={canEdit} />
        </>
      ) : null}
    </div>
  );
}

function FigureTile({
  label,
  f,
  onShow,
}: {
  label: string;
  f: Figure;
  onShow: (label: string, f: Figure) => void;
}) {
  return (
    <Card className="gap-1.5">
      <span className="text-[13px] text-ink-muted">{label}</span>
      <span className="font-display text-2xl font-semibold tabular-nums">
        <Money amount={f.value} />
      </span>
      <button
        type="button"
        className="cursor-pointer self-start border-0 bg-transparent p-0 text-xs text-forest underline"
        onClick={() => onShow(label, f)}
        disabled={!f.sources.length}
      >
        {f.sources.length} transaction{f.sources.length === 1 ? '' : 's'} behind this
      </button>
    </Card>
  );
}

function Flags({
  analysis,
  canEdit,
  onShow,
}: {
  analysis: NonNullable<CashflowView['analysis']>;
  canEdit: boolean;
  onShow: (label: string, ids: string[]) => void;
}) {
  const [deciding, setDeciding] = useState<string | null>(null);
  if (!analysis.flags.length) {
    return (
      <Card>
        <p className="m-0 text-sm text-ink-muted">No integrity or risk flags.</p>
      </Card>
    );
  }
  const flag = analysis.flags.find((f) => f.id === deciding);
  return (
    <Card className="gap-3">
      <CardTitle>Flags to review</CardTitle>
      <p className="m-0 text-sm text-ink-muted">
        A flag never rejects an application. Record what you found for each one.
      </p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {analysis.flags.map((f) => (
          <li
            key={f.id}
            className="flex flex-wrap items-center gap-2 rounded-control border border-line p-3 text-sm"
          >
            <Pill tone={SEVERITY_TONE[f.severity]}>{f.severity.toLowerCase()}</Pill>
            <span className="mr-auto">{f.message}</span>
            {f.evidence.length ? (
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-xs text-forest underline"
                onClick={() => onShow(f.message, f.evidence)}
              >
                Show evidence
              </button>
            ) : null}
            {f.outcome === 'PENDING' ? (
              canEdit ? (
                <Button variant="secondary" onClick={() => setDeciding(f.id)}>
                  Record outcome
                </Button>
              ) : (
                <Pill tone="warning">Open</Pill>
              )
            ) : (
              <span className="text-xs text-ink-muted">
                {f.outcome === 'CONFIRMED' ? 'Confirmed' : 'Dismissed'}: {f.outcomeNote}
              </span>
            )}
          </li>
        ))}
      </ul>
      {flag ? <FlagModal flag={flag} onClose={() => setDeciding(null)} /> : null}
    </Card>
  );
}

function FlagModal({
  flag,
  onClose,
}: {
  flag: NonNullable<CashflowView['analysis']>['flags'][number];
  onClose: () => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(outcome: 'DISMISSED' | 'CONFIRMED') {
    setBusy(true);
    setError(null);
    try {
      await api(`/cashflow/flags/${flag.id}`, { method: 'POST', body: { outcome, note } });
      onClose();
      router.refresh();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Flag outcome" subtitle={flag.message}>
      <div className="flex flex-col gap-4">
        <TextAreaField
          label="What did you find?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          data-autofocus
        />
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2.5">
          <Button
            variant="secondary"
            disabled={busy || note.trim().length < 3}
            onClick={() => decide('DISMISSED')}
          >
            Not a concern
          </Button>
          <Button
            loading={busy}
            disabled={note.trim().length < 3}
            onClick={() => decide('CONFIRMED')}
          >
            Confirmed
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Transactions({
  analysis,
  canEdit,
  focus,
  onClear,
}: {
  analysis: NonNullable<CashflowView['analysis']>;
  canEdit: boolean;
  focus: { label: string; ids: Set<string> } | null;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const rows = useMemo(
    () =>
      focus ? analysis.transactions.filter((t) => focus.ids.has(t.id)) : analysis.transactions,
    [analysis.transactions, focus],
  );
  const txn = analysis.transactions.find((t) => t.id === editing);
  return (
    <Card className="gap-3" id="transactions">
      <div className="flex flex-wrap items-center gap-2">
        <CardTitle>Transactions</CardTitle>
        {focus ? (
          <>
            <Pill tone="info">{focus.label}</Pill>
            <Button variant="ghost" onClick={onClear}>
              Show all
            </Button>
          </>
        ) : null}
        <span className="ml-auto text-xs text-ink-muted">
          {rows.length} of {analysis.transactions.length}
        </span>
      </div>
      <Table minWidth={760}>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Description</Th>
            <Th numeric>In</Th>
            <Th numeric>Out</Th>
            <Th numeric>Balance</Th>
            <Th>Category</Th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((t) => (
            <tr key={t.id}>
              <Td className="whitespace-nowrap text-ink-soft">{formatDate(t.date)}</Td>
              <Td className="max-w-[300px] truncate">{t.description}</Td>
              <Td numeric>{t.direction === 'IN' ? <Money amount={t.amount} bare /> : ''}</Td>
              <Td numeric className="font-normal">
                {t.direction === 'OUT' ? <Money amount={t.amount} bare /> : ''}
              </Td>
              <Td numeric className="font-normal text-ink-muted">
                {t.balance ? <Money amount={t.balance} bare /> : ''}
              </Td>
              <Td>
                {canEdit ? (
                  <button
                    type="button"
                    className="cursor-pointer border-0 bg-transparent p-0 text-left text-sm text-forest underline"
                    onClick={() => setEditing(t.id)}
                  >
                    {CASHFLOW_CATEGORY_LABELS[t.category]}
                  </button>
                ) : (
                  CASHFLOW_CATEGORY_LABELS[t.category]
                )}
                {t.corrected ? (
                  <span className="block text-xs text-ink-muted">corrected</span>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {txn ? <CategoryModal txn={txn} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function CategoryModal({
  txn,
  onClose,
}: {
  txn: NonNullable<CashflowView['analysis']>['transactions'][number];
  onClose: () => void;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<CashflowCategory>(txn.category);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/cashflow/transactions/${txn.id}`, {
        method: 'PATCH',
        body: { category, reason },
      });
      onClose();
      router.refresh();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Change category"
      subtitle={`${formatDate(txn.date)} · ${txn.description}`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value as CashflowCategory)}
        >
          {CASHFLOW_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CASHFLOW_CATEGORY_LABELS[c]}
            </option>
          ))}
        </SelectField>
        <TextField label="Why?" value={reason} onChange={(e) => setReason(e.target.value)} />
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={category === txn.category || reason.trim().length < 3}
          >
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Review({ view, canEdit }: { view: CashflowView; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const a = view.analysis!;
  const [income, setIncome] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openFlags = a.flags.filter((f) => f.outcome === 'PENDING').length;

  if (a.status === 'REVIEWED') {
    return (
      <Card className="gap-2">
        <CardTitle>Analyst review</CardTitle>
        <p className="m-0 text-sm">
          Confirmed income <Money amount={a.confirmedIncome ?? '0'} /> a month
          {a.reviewedAt ? `, ${dateTime(a.reviewedAt)}` : ''}. This is now the borrower’s verified
          income for the affordability rule.
        </p>
        {a.reviewNote ? <p className="m-0 text-sm text-ink-muted">“{a.reviewNote}”</p> : null}
      </Card>
    );
  }
  if (!canEdit) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/cashflow/analyses/${a.id}/review`, {
        method: 'POST',
        body: { confirmedIncome: income.replace(/,/g, ''), note },
      });
      toast('Review saved. Verified income updated.');
      router.refresh();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <Card className="gap-3">
      <CardTitle>Your review</CardTitle>
      <p className="m-0 text-sm text-ink-muted">
        Enter the monthly income you are confident in, from your own assessment. It becomes the
        borrower’s verified income; the AI figure is kept only for comparison.
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <TextField
          label="Confirmed monthly income (RWF)"
          inputMode="numeric"
          value={income}
          onChange={(e) => setIncome(groupDigits(e.target.value))}
          className="w-[260px]"
        />
        <TextField
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-w-[260px] flex-1"
        />
        <Button type="submit" loading={busy} disabled={!income || openFlags > 0}>
          Confirm review
        </Button>
      </form>
      {openFlags ? (
        <p className="m-0 text-xs text-warning-fg">
          {openFlags} flag{openFlags === 1 ? '' : 's'} still need an outcome.
        </p>
      ) : null}
      <FormError>{error}</FormError>
    </Card>
  );
}

function UploadDocument({ code }: { code: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<'MOMO_STATEMENT' | 'BANK_STATEMENT' | 'PAYSLIP'>(
    'MOMO_STATEMENT',
  );
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);
    try {
      await api(`/applications/${code}/cashflow/documents`, { method: 'POST', body: form });
      setFile(null);
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-line pt-3">
      <SelectField
        label="Document"
        value={kind}
        onChange={(e) => setKind(e.target.value as typeof kind)}
      >
        <option value="MOMO_STATEMENT">Mobile money statement</option>
        <option value="BANK_STATEMENT">Bank statement</option>
        <option value="PAYSLIP">Payslip</option>
      </SelectField>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-soft">
        File (PDF, photo or CSV export)
        <input
          type="file"
          accept=".pdf,.csv,image/jpeg,image/png,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
      </label>
      <FormError>{error}</FormError>
      <Button
        type="submit"
        variant="secondary"
        loading={busy}
        disabled={!file}
        className="self-start"
      >
        Upload
      </Button>
    </form>
  );
}
