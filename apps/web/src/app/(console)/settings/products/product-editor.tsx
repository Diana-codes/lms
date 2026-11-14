'use client';

import {
  COMPONENT_LABELS,
  type Component,
  FEE_TIMING_LABELS,
  FEE_TIMINGS,
  type FeeRule,
  FREQUENCIES,
  FREQUENCY_LABELS,
  INTEREST_METHOD_LABELS,
  INTEREST_METHODS,
  type LoanTerms,
  OVERPAYMENT_LABELS,
  OVERPAYMENT_RULES,
  PAYOFF_INTEREST_LABELS,
  PAYOFF_INTEREST_RULES,
  PENALTY_METHOD_LABELS,
  PENALTY_METHODS,
  PRODUCT_KIND_LABELS,
  PRODUCT_KINDS,
  type ProductKind,
  ROUNDING_UNITS,
  termsProblems,
} from '@kora/core';
import {
  Button,
  Card,
  CardTitle,
  FormError,
  Pill,
  SelectField,
  TextAreaField,
  TextField,
  useToast,
} from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { groupDigits } from '@/lib/format';
import type { ProductDetail } from '@/lib/types';
import { QuotePreview } from './quote-preview';
import { STATUS_PILL } from './status';

interface Form {
  code: string;
  name: string;
  shortName: string;
  kind: ProductKind;
  description: string;
  minAmount: string;
  maxAmount: string;
  minTermMonths: string;
  maxTermMonths: string;
  affordabilityBps: number;
  secondApprovalAbove: string;
  autoApproveMinScore: string;
  autoApproveMaxAmount: string;
  terms: LoanTerms;
}

const digits = (s: string) => s.replace(/\D/g, '');
const orNull = (s: string) => (digits(s) ? digits(s) : null);

function fromProduct(p: ProductDetail): Form {
  return {
    code: p.code,
    name: p.name,
    shortName: p.shortName,
    kind: p.kind,
    description: p.description ?? '',
    minAmount: groupDigits(p.minAmount),
    maxAmount: groupDigits(p.maxAmount),
    minTermMonths: String(p.minTermMonths),
    maxTermMonths: String(p.maxTermMonths),
    affordabilityBps: p.affordabilityBps,
    secondApprovalAbove: p.secondApprovalAbove ? groupDigits(p.secondApprovalAbove) : '',
    autoApproveMinScore: p.autoApproveMinScore != null ? String(p.autoApproveMinScore) : '',
    autoApproveMaxAmount: p.autoApproveMaxAmount ? groupDigits(p.autoApproveMaxAmount) : '',
    terms: p.terms,
  };
}

function blank(defaults: LoanTerms): Form {
  return {
    code: '',
    name: '',
    shortName: '',
    kind: 'SME',
    description: '',
    minAmount: '100,000',
    maxAmount: '5,000,000',
    minTermMonths: '3',
    maxTermMonths: '24',
    affordabilityBps: 3500,
    secondApprovalAbove: '',
    autoApproveMinScore: '',
    autoApproveMaxAmount: '',
    terms: defaults,
  };
}

/** A percentage typed as text ("2.5"), held as basis points (250). */
function PercentField({
  label,
  bps,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  bps: number;
  onChange: (bps: number) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(bps / 100));
  const [shown, setShown] = useState(bps);
  if (shown !== bps && Math.round(Number(text) * 100) !== bps) {
    setShown(bps);
    setText(String(bps / 100));
  }
  return (
    <TextField
      label={label}
      inputMode="decimal"
      hint={hint}
      disabled={disabled}
      value={text}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d.]/g, '');
        setText(v);
        const n = Number(v);
        if (v !== '' && Number.isFinite(n)) {
          const next = Math.round(n * 100);
          setShown(next);
          onChange(next);
        }
      }}
    />
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {children}
    </Card>
  );
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'fee';

/**
 * The product editor. Every engine option, with a live sample loan beside
 * it. Administrators edit; managers see the same screen read-only.
 */
export function ProductEditor({
  product,
  defaults,
  canEdit,
}: {
  product: ProductDetail | null;
  defaults: LoanTerms;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<Form>(() => (product ? fromProduct(product) : blank(defaults)));
  const [busy, setBusy] = useState<'save' | 'publish' | 'retire' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retired = product?.status === 'RETIRED';
  const readOnly = !canEdit || retired;
  const t = form.terms;

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setTerms = (patch: Partial<LoanTerms>) =>
    setForm((f) => ({ ...f, terms: { ...f.terms, ...patch } }));
  const setPenalty = (patch: Partial<LoanTerms['penalty']>) =>
    setTerms({ penalty: { ...t.penalty, ...patch } });
  const setFee = (i: number, patch: Partial<FeeRule>) =>
    setTerms({ fees: t.fees.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

  const problems = termsProblems(t);

  function move(i: number, by: -1 | 1) {
    const order = [...t.allocationOrder];
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    setTerms({ allocationOrder: order });
  }

  function addFee() {
    const used = new Set(t.fees.map((f) => f.code));
    let code = 'fee';
    for (let n = 2; used.has(code); n++) code = `fee-${n}`;
    setTerms({
      fees: [
        ...t.fees,
        {
          code,
          name: '',
          basis: 'PERCENT',
          value: 100,
          min: null,
          max: null,
          timing: 'DEDUCTED',
          thirdParty: false,
          vat: true,
        },
      ],
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (problems.length) return;
    setBusy('save');
    setError(null);
    const body = {
      name: form.name,
      shortName: form.shortName,
      description: form.description.trim() || null,
      kind: form.kind,
      terms: t,
      minAmount: digits(form.minAmount),
      maxAmount: digits(form.maxAmount),
      minTermMonths: Number(form.minTermMonths),
      maxTermMonths: Number(form.maxTermMonths),
      affordabilityBps: form.affordabilityBps,
      secondApprovalAbove: orNull(form.secondApprovalAbove),
      autoApproveMinScore: form.autoApproveMinScore ? Number(form.autoApproveMinScore) : null,
      autoApproveMaxAmount: orNull(form.autoApproveMaxAmount),
    };
    try {
      if (product) {
        const saved = await api<ProductDetail>(`/products/${product.code}`, {
          method: 'PUT',
          body,
        });
        toast(
          saved.version !== product.version
            ? `Saved as version ${saved.version}. Existing loans keep their terms.`
            : 'Saved.',
        );
        router.refresh();
      } else {
        const saved = await api<ProductDetail>('/products', {
          method: 'POST',
          body: { ...body, code: form.code },
        });
        toast('Product created as a draft. Publish it when it is ready.');
        router.push(`/settings/products/${saved.code}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(to: 'publish' | 'retire') {
    if (!product) return;
    const question =
      to === 'publish'
        ? `Publish ${product.name}? Staff and borrowers can then apply for it.`
        : `Retire ${product.name}? It takes no new applications; existing loans carry on unchanged.`;
    if (!window.confirm(question)) return;
    setBusy(to);
    setError(null);
    try {
      await api(`/products/${product.code}/${to}`, { method: 'POST' });
      toast(to === 'publish' ? 'Published.' : 'Retired.');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={save} noValidate className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
        <Section title="About the product">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. SME working capital"
            />
            <TextField
              label="Short name"
              hint="Shown on pipeline cards"
              value={form.shortName}
              onChange={(e) => set('shortName', e.target.value)}
              maxLength={20}
            />
            <TextField
              label="Code"
              hint={product ? 'Cannot change once created' : '2–20 capitals, digits or hyphens'}
              value={form.code}
              disabled={!!product}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              placeholder="e.g. SME-WC"
            />
            <SelectField
              label="Kind"
              value={form.kind}
              onChange={(e) => set('kind', e.target.value as ProductKind)}
            >
              {PRODUCT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PRODUCT_KIND_LABELS[k]}
                </option>
              ))}
            </SelectField>
          </div>
          <TextAreaField
            label="Description (optional)"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Section>

        <Section title="Amounts and terms">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Smallest amount (RWF)"
              inputMode="numeric"
              value={form.minAmount}
              onChange={(e) => set('minAmount', groupDigits(e.target.value))}
            />
            <TextField
              label="Largest amount (RWF)"
              inputMode="numeric"
              value={form.maxAmount}
              onChange={(e) => set('maxAmount', groupDigits(e.target.value))}
            />
            <TextField
              label="Shortest term (months)"
              inputMode="numeric"
              value={form.minTermMonths}
              onChange={(e) => set('minTermMonths', digits(e.target.value))}
            />
            <TextField
              label="Longest term (months)"
              inputMode="numeric"
              value={form.maxTermMonths}
              onChange={(e) => set('maxTermMonths', digits(e.target.value))}
            />
          </div>
        </Section>

        <Section title="Interest and repayment">
          <SelectField
            label="Interest method"
            value={t.interestMethod}
            onChange={(e) =>
              setTerms({ interestMethod: e.target.value as LoanTerms['interestMethod'] })
            }
          >
            {INTEREST_METHODS.map((m) => (
              <option key={m} value={m}>
                {INTEREST_METHOD_LABELS[m]}
              </option>
            ))}
          </SelectField>
          <div className="grid gap-3 sm:grid-cols-2">
            <PercentField
              label="Interest rate (%)"
              bps={t.rateBps}
              onChange={(rateBps) => setTerms({ rateBps })}
            />
            <SelectField
              label="Rate is quoted"
              value={t.ratePeriod}
              onChange={(e) => setTerms({ ratePeriod: e.target.value as LoanTerms['ratePeriod'] })}
            >
              <option value="YEAR">Per year</option>
              <option value="MONTH">Per month</option>
            </SelectField>
            <SelectField
              label="Repayments"
              value={t.frequency}
              onChange={(e) => {
                const frequency = e.target.value as LoanTerms['frequency'];
                setTerms({
                  frequency,
                  dueDayOfMonth: frequency === 'MONTHLY' ? t.dueDayOfMonth : null,
                });
              }}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABELS[f]}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Due day"
              value={t.dueDayOfMonth == null ? '' : String(t.dueDayOfMonth)}
              disabled={t.frequency !== 'MONTHLY'}
              onChange={(e) =>
                setTerms({ dueDayOfMonth: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">One period after payout</option>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  Day {d} of each month
                </option>
              ))}
            </SelectField>
            <TextField
              label="Grace periods (interest only)"
              inputMode="numeric"
              hint="Instalments at the start that pay interest only"
              value={String(t.principalGracePeriods)}
              onChange={(e) =>
                setTerms({ principalGracePeriods: Number(digits(e.target.value) || 0) })
              }
            />
            <SelectField
              label="Round instalments to"
              value={String(t.roundingUnit)}
              onChange={(e) =>
                setTerms({ roundingUnit: Number(e.target.value) as LoanTerms['roundingUnit'] })
              }
            >
              {ROUNDING_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u === 1 ? 'The nearest franc' : `The nearest ${u} francs`}
                </option>
              ))}
            </SelectField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={t.moveOffNonWorkingDays}
              onChange={(e) => setTerms({ moveOffNonWorkingDays: e.target.checked })}
            />
            Move due dates off weekends and Rwandan public holidays
          </label>
        </Section>

        <Section title="Fees">
          <p className="m-0 text-sm text-ink-muted">
            Loan interest and late charges are VAT-exempt in Rwanda; fees are not. Tick VAT if the
            company is VAT-registered. Third-party charges (insurance, notary) are collected for
            someone else and left out of the APR.
          </p>
          {t.fees.length === 0 ? <p className="m-0 text-sm">No fees.</p> : null}
          {t.fees.map((fee, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-control border border-line p-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <TextField
                  label="Fee name"
                  value={fee.name}
                  onChange={(e) =>
                    setFee(i, {
                      name: e.target.value,
                      ...(product ? {} : { code: slug(e.target.value) }),
                    })
                  }
                />
                <SelectField
                  label="Charged as"
                  value={fee.basis}
                  onChange={(e) => setFee(i, { basis: e.target.value as FeeRule['basis'] })}
                >
                  <option value="PERCENT">% of the amount</option>
                  <option value="FIXED">Fixed RWF</option>
                </SelectField>
                {fee.basis === 'PERCENT' ? (
                  <PercentField
                    label="Percent"
                    bps={fee.value}
                    onChange={(value) => setFee(i, { value })}
                  />
                ) : (
                  <TextField
                    label="Amount (RWF)"
                    inputMode="numeric"
                    value={groupDigits(String(fee.value))}
                    onChange={(e) => setFee(i, { value: Number(digits(e.target.value) || 0) })}
                  />
                )}
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <SelectField
                  label="Collected"
                  className="min-w-[220px]"
                  value={fee.timing}
                  onChange={(e) => setFee(i, { timing: e.target.value as FeeRule['timing'] })}
                >
                  {FEE_TIMINGS.map((ft) => (
                    <option key={ft} value={ft}>
                      {FEE_TIMING_LABELS[ft]}
                    </option>
                  ))}
                </SelectField>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={fee.vat}
                    onChange={(e) => setFee(i, { vat: e.target.checked })}
                  />
                  Add {t.vatBps / 100}% VAT
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={fee.thirdParty}
                    onChange={(e) => setFee(i, { thirdParty: e.target.checked })}
                  />
                  For a third party
                </label>
                <Button
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => setTerms({ fees: t.fees.filter((_, j) => j !== i) })}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <Button variant="secondary" className="self-start" onClick={addFee}>
            Add a fee
          </Button>
        </Section>

        <Section title="Late payments">
          <SelectField
            label="Late charge"
            value={t.penalty.method}
            onChange={(e) =>
              setPenalty({ method: e.target.value as LoanTerms['penalty']['method'] })
            }
          >
            {PENALTY_METHODS.map((m) => (
              <option key={m} value={m}>
                {PENALTY_METHOD_LABELS[m]}
              </option>
            ))}
          </SelectField>
          {t.penalty.method !== 'NONE' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField
                label="Grace days"
                inputMode="numeric"
                value={String(t.penalty.graceDays)}
                onChange={(e) => setPenalty({ graceDays: Number(digits(e.target.value) || 0) })}
              />
              {t.penalty.method === 'FIXED_PER_INSTALMENT' ? (
                <TextField
                  label="Amount (RWF)"
                  inputMode="numeric"
                  value={groupDigits(String(t.penalty.amount))}
                  onChange={(e) => setPenalty({ amount: Number(digits(e.target.value) || 0) })}
                />
              ) : (
                <PercentField
                  label={
                    t.penalty.method === 'DAILY_RATE_ON_OVERDUE' ? 'Rate a year (%)' : 'Percent (%)'
                  }
                  bps={t.penalty.bps}
                  onChange={(bps) => setPenalty({ bps })}
                />
              )}
              <PercentField
                label="Cap (% of amount)"
                hint="0 for no cap"
                bps={t.penalty.capBps ?? 0}
                onChange={(bps) => setPenalty({ capBps: bps === 0 ? null : bps })}
              />
            </div>
          ) : null}
        </Section>

        <Section title="Payments">
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">
              Each payment covers, in this order (oldest instalment first)
            </legend>
            <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
              {t.allocationOrder.map((c: Component, i) => (
                <li
                  key={c}
                  className="flex items-center gap-3 rounded-control border border-line px-3 py-2 text-sm"
                >
                  <span className="w-5 text-ink-muted">{i + 1}.</span>
                  <span className="mr-auto">{COMPONENT_LABELS[c]}</span>
                  <Button
                    variant="ghost"
                    aria-label={`Move ${COMPONENT_LABELS[c]} up`}
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Move ${COMPONENT_LABELS[c]} down`}
                    onClick={() => move(i, 1)}
                    disabled={i === t.allocationOrder.length - 1}
                  >
                    ↓
                  </Button>
                </li>
              ))}
            </ol>
          </fieldset>
          <SelectField
            label="When someone pays more than is due"
            value={t.overpayment}
            onChange={(e) => setTerms({ overpayment: e.target.value as LoanTerms['overpayment'] })}
          >
            {OVERPAYMENT_RULES.map((r) => (
              <option key={r} value={r}>
                {OVERPAYMENT_LABELS[r]}
              </option>
            ))}
          </SelectField>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Paying off early costs"
              value={t.payoff.interest}
              onChange={(e) =>
                setTerms({
                  payoff: {
                    ...t.payoff,
                    interest: e.target.value as LoanTerms['payoff']['interest'],
                  },
                })
              }
            >
              {PAYOFF_INTEREST_RULES.map((r) => (
                <option key={r} value={r}>
                  {PAYOFF_INTEREST_LABELS[r]}
                </option>
              ))}
            </SelectField>
            <PercentField
              label="Early repayment fee (%)"
              hint="Of the principal repaid early; 0 for none"
              bps={t.payoff.feeBps}
              onChange={(feeBps) => setTerms({ payoff: { ...t.payoff, feeBps } })}
            />
          </div>
          {t.payoff.feeBps > 0 ? (
            <p className="m-0 rounded-control bg-caution-bg px-3.5 py-2.5 text-[13px] text-caution-ink">
              BNR&apos;s Key Facts Statement template tells borrowers they can pay off early without
              penalties or fees. Check with your compliance officer before charging an early
              repayment fee.
            </p>
          ) : null}
        </Section>

        <Section title="Approvals">
          <div className="grid gap-3 sm:grid-cols-2">
            <PercentField
              label="Instalments at most (% of income)"
              bps={form.affordabilityBps}
              onChange={(bps) => set('affordabilityBps', bps)}
            />
            <TextField
              label="Second approver above (RWF)"
              inputMode="numeric"
              hint="Empty: one approver is enough"
              value={form.secondApprovalAbove}
              onChange={(e) => set('secondApprovalAbove', groupDigits(e.target.value))}
            />
            <TextField
              label="Bulk-approve from score"
              inputMode="numeric"
              hint="Empty: never eligible"
              value={form.autoApproveMinScore}
              onChange={(e) => set('autoApproveMinScore', digits(e.target.value))}
            />
            <TextField
              label="Bulk-approve up to (RWF)"
              inputMode="numeric"
              value={form.autoApproveMaxAmount}
              onChange={(e) => set('autoApproveMaxAmount', groupDigits(e.target.value))}
            />
          </div>
        </Section>
      </fieldset>

      <aside className="flex flex-col gap-6 xl:sticky xl:top-6 xl:self-start">
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="mr-auto">
              {product ? `Version ${product.version}` : 'New product'}
            </CardTitle>
            {product ? (
              <Pill tone={STATUS_PILL[product.status].tone}>
                {STATUS_PILL[product.status].label}
              </Pill>
            ) : null}
          </div>
          {product ? (
            <p className="m-0 text-sm text-ink-muted">
              {product.loans} {product.loans === 1 ? 'loan' : 'loans'} issued. Changing the terms
              makes a new version; loans already issued keep theirs.
            </p>
          ) : null}
          {problems.length ? (
            <ul className="m-0 flex flex-col gap-1 rounded-control bg-caution-bg px-4 py-3 text-sm text-caution-ink">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          <FormError>{error}</FormError>
          {!readOnly ? (
            <div className="flex flex-wrap gap-3">
              <Button type="submit" loading={busy === 'save'} disabled={problems.length > 0}>
                {product ? 'Save changes' : 'Create draft'}
              </Button>
              {product?.status === 'DRAFT' ? (
                <Button
                  variant="secondary"
                  loading={busy === 'publish'}
                  onClick={() => setStatus('publish')}
                >
                  Publish
                </Button>
              ) : null}
              {product?.status === 'PUBLISHED' ? (
                <Button
                  variant="danger"
                  loading={busy === 'retire'}
                  onClick={() => setStatus('retire')}
                >
                  Retire
                </Button>
              ) : null}
            </div>
          ) : null}
        </Card>
        <QuotePreview
          terms={t}
          minAmount={digits(form.minAmount)}
          maxAmount={digits(form.maxAmount)}
          minTermMonths={Number(form.minTermMonths) || 1}
          maxTermMonths={Number(form.maxTermMonths) || 1}
          valid={problems.length === 0}
        />
      </aside>
    </form>
  );
}
