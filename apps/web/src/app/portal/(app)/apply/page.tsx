'use client';

import { formatBps } from '@kora/core';
import { Button, FormError, Money, SelectField, TextField } from '@kora/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { portalApi, portalErrorMessage } from '@/lib/portal/api';
import type { PortalApplyOptions, PortalQuote } from '@/lib/portal/types';
import { PortalNav } from '../../portal-nav';

const SECTORS = ['Garments & tailoring', 'Retail shop', 'Agriculture', 'Transport', 'Other'];
const STEP_ROUND = 100_000n;
const CONSENT_VERSION = '2026-01';

const groupDigits = (s: string) => s.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export default function PortalApplyPage() {
  const router = useRouter();
  const [options, setOptions] = useState<PortalApplyOptions | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 'sent'>(1);
  const [productCode, setProductCode] = useState('');
  const [amount, setAmount] = useState('');
  const [termMonths, setTermMonths] = useState(12);
  const [purpose, setPurpose] = useState('Equipment');
  const [businessName, setBusinessName] = useState('');
  const [businessSector, setBusinessSector] = useState(SECTORS[0]!);
  const [monthlyRevenue, setMonthlyRevenue] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [shareMomo, setShareMomo] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [bureau, setBureau] = useState(true);
  const [quote, setQuote] = useState<PortalQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ code: string; status: string; expected: string } | null>(
    null,
  );
  // `expected` is a human phrase from the API (e.g. "Within 1 working day").

  useEffect(() => {
    portalApi<PortalApplyOptions>('/app/apply/options')
      .then((o) => {
        setOptions(o);
        const product = o.products[0];
        if (!product) return;
        setProductCode(product.code);
        const max = o.preApprovedLimit ? BigInt(o.preApprovedLimit) : BigInt(product.maxAmount);
        const start = (max / 2n / STEP_ROUND) * STEP_ROUND || BigInt(product.minAmount);
        setAmount(groupDigits(start.toString()));
        setTermMonths(product.terms.includes(12) ? 12 : product.terms[0]!);
        setPurpose(o.purposes[0] ?? 'Equipment');
        setBusinessName(o.prefill.businessName ?? '');
        setBusinessSector(o.prefill.sector ?? SECTORS[0]!);
        setMonthlyRevenue(
          o.prefill.monthlyRevenue ? groupDigits(o.prefill.monthlyRevenue) : '',
        );
      })
      .catch((e) => setError(portalErrorMessage(e)));
  }, []);

  const product = useMemo(
    () => options?.products.find((p) => p.code === productCode) ?? options?.products[0],
    [options, productCode],
  );

  const amountBig = useMemo(() => {
    try {
      return BigInt(amount.replace(/\D/g, '') || '0');
    } catch {
      return 0n;
    }
  }, [amount]);

  useEffect(() => {
    if (!product || amountBig <= 0n || step !== 1) return;
    const t = setTimeout(() => {
      portalApi<PortalQuote>(
        `/app/apply/quote?productCode=${encodeURIComponent(product.code)}&amount=${amountBig}&termMonths=${termMonths}`,
      )
        .then(setQuote)
        .catch(() => setQuote(null));
    }, 250);
    return () => clearTimeout(t);
  }, [product, amountBig, termMonths, step]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!product || !agreed) return;
    setBusy(true);
    setError(null);
    try {
      const r = await portalApi<{ code: string; status: string; expected: string }>('/app/apply', {
        method: 'POST',
        body: {
          productCode: product.code,
          amount: amountBig.toString(),
          termMonths,
          purpose,
          businessName: businessName.trim() || undefined,
          businessSector: businessSector.trim() || undefined,
          monthlyRevenue: monthlyRevenue.replace(/\D/g, '') || undefined,
          nationalId: nationalId.replace(/\D/g, '').length === 16 ? nationalId : undefined,
          shareMomoHistory: shareMomo,
          agreedTerms: true,
          agreedBureau: bureau,
          consentVersion: CONSENT_VERSION,
        },
      });
      setResult({ code: r.code, status: r.status, expected: r.expected });
      setStep('sent');
    } catch (err) {
      setError(portalErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!options && !error) {
    return (
      <>
        <main className="flex flex-1 items-center justify-center p-6 text-sm text-ink-muted">
          Loading products…
        </main>
        <PortalNav />
      </>
    );
  }

  if (options && options.products.length === 0) {
    return (
      <>
        <main className="flex flex-1 flex-col gap-3 p-5">
          <h1 className="m-0 font-display text-xl font-semibold">Apply</h1>
          <p className="m-0 text-sm text-ink-muted">
            No products are open for applications right now. Check back later.
          </p>
          <Link href="/portal/home">
            <Button type="button" variant="secondary">
              Back to home
            </Button>
          </Link>
        </main>
        <PortalNav />
      </>
    );
  }

  return (
    <>
      <main className="flex flex-1 flex-col gap-5 p-5 pb-8">
        <h1 className="m-0 font-display text-xl font-semibold">Apply for a loan</h1>

        {step !== 'sent' ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-xs text-ink-muted">
              Step {step} of 3 ·{' '}
              {step === 1 ? 'Amount' : step === 2 ? 'About you' : 'Confirm'}
            </p>
            <div className="flex gap-1.5">
              {[1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-forest' : 'bg-line'}`}
                />
              ))}
            </div>
          </div>
        ) : null}

        {step === 'sent' && result ? (
          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
            <h2 className="m-0 font-display text-lg font-semibold">Application sent</h2>
            <p className="m-0 text-sm text-ink-muted">
              {result.code} · {result.status}. Decision: {result.expected}.
            </p>
            <Button type="button" onClick={() => router.push('/portal/home')}>
              Back to home
            </Button>
          </section>
        ) : null}

        {step === 1 && product ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setStep(2);
            }}
          >
            {options!.products.length > 1 ? (
              <SelectField
                label="Product"
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
              >
                {options!.products.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </SelectField>
            ) : (
              <p className="m-0 text-sm text-ink-muted">{product.name}</p>
            )}
            <TextField
              label="Amount (RWF)"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(groupDigits(e.target.value))}
              required
            />
            <SelectField
              label="Term (months)"
              value={String(termMonths)}
              onChange={(e) => setTermMonths(Number(e.target.value))}
            >
              {product.terms.map((t) => (
                <option key={t} value={t}>
                  {t} months
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            >
              {(options?.purposes?.length ? options.purposes : ['Equipment', 'Stock', 'Working capital']).map(
                (p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ),
              )}
            </SelectField>
            {quote ? (
              <div className="rounded-xl border border-line bg-surface p-4 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-ink-muted">Instalment</span>
                  <span className="font-semibold">
                    <Money amount={quote.monthly} />
                  </span>
                </div>
                <div className="mt-1 flex justify-between gap-3">
                  <span className="text-ink-muted">Total to repay</span>
                  <span className="font-semibold">
                    <Money amount={quote.totalToRepay} />
                  </span>
                </div>
                <div className="mt-1 flex justify-between gap-3">
                  <span className="text-ink-muted">Rate</span>
                  <span>{formatBps(quote.annualRateBps, 0)} a year</span>
                </div>
                {quote.affordability && !quote.affordability.affordable ? (
                  <p className="m-0 mt-2 text-xs text-amber">
                    This instalment is above the usual share of your income. You can still apply;
                    a loan officer will review it.
                  </p>
                ) : null}
              </div>
            ) : null}
            <Button type="submit" disabled={amountBig <= 0n}>
              Continue
            </Button>
          </form>
        ) : null}

        {step === 2 ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setStep(3);
            }}
          >
            <TextField
              label="Business name"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              maxLength={120}
            />
            <SelectField
              label="Sector"
              value={businessSector}
              onChange={(e) => setBusinessSector(e.target.value)}
            >
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Typical monthly revenue (RWF)"
              inputMode="numeric"
              value={monthlyRevenue}
              onChange={(e) => setMonthlyRevenue(groupDigits(e.target.value))}
            />
            {!options?.prefill.kycVerified ? (
              <TextField
                label="National ID (16 digits)"
                inputMode="numeric"
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value.replace(/\D/g, '').slice(0, 16))}
                maxLength={16}
              />
            ) : (
              <p className="m-0 text-sm text-ink-muted">
                ID on file: {options.prefill.nationalIdMasked}
              </p>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={shareMomo}
                onChange={(e) => setShareMomo(e.target.checked)}
              />
              Share my MoMo history to help with the decision
            </label>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button type="submit">Continue</Button>
            </div>
          </form>
        ) : null}

        {step === 3 ? (
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="rounded-xl border border-line bg-surface p-4 text-sm">
              <p className="m-0 font-semibold">{product?.name}</p>
              <p className="m-0 mt-1 text-ink-muted">
                <Money amount={amountBig.toString()} /> · {termMonths} months · {purpose}
              </p>
              {quote ? (
                <p className="m-0 mt-2">
                  About <Money amount={quote.monthly} /> per instalment
                </p>
              ) : null}
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                required
              />
              I agree to the loan terms and that my details may be used to assess this application
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={bureau}
                onChange={(e) => setBureau(e.target.checked)}
              />
              I agree to a credit bureau check if needed
            </label>
            <FormError>{error}</FormError>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button type="submit" disabled={busy || !agreed}>
                {busy ? 'Sending…' : 'Submit application'}
              </Button>
            </div>
          </form>
        ) : null}

        {error && step !== 3 ? <FormError>{error}</FormError> : null}
      </main>
      <PortalNav />
    </>
  );
}
