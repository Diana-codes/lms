'use client';

import { formatBps, formatRwf } from '@kora/core';
import { Button, FormError, Money, SelectField, TextField } from '@kora/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { portalApi } from '@/lib/portal/api';
import { takeApplyProduct } from '@/lib/portal/apply-intent';
import { usePortalI18n } from '@/lib/portal/i18n';
import type { PortalApplyOptions, PortalQuote } from '@/lib/portal/types';
import { PortalNav } from '../../portal-nav';

const SECTORS = ['Garments & tailoring', 'Retail shop', 'Agriculture', 'Transport', 'Other'];
const STEP_ROUND = 100_000n;
const CONSENT_VERSION = '2026-01';

const groupDigits = (s: string) => s.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export default function PortalApplyPage() {
  const router = useRouter();
  const { t, option, lender: lenderName, error: errorText } = usePortalI18n();
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
        // A product chosen on the website comes first, if it is still offered.
        const wanted = takeApplyProduct();
        const product = o.products.find((p) => p.code === wanted) ?? o.products[0];
        if (!product) return;
        setProductCode(product.code);
        const max = o.preApprovedLimit ? BigInt(o.preApprovedLimit) : BigInt(product.maxAmount);
        const start = (max / 2n / STEP_ROUND) * STEP_ROUND || BigInt(product.minAmount);
        setAmount(groupDigits(start.toString()));
        setTermMonths(product.terms.includes(12) ? 12 : product.terms[0]!);
        setPurpose(o.purposes[0] ?? 'Equipment');
        setBusinessName(o.prefill.businessName ?? '');
        setBusinessSector(o.prefill.sector ?? SECTORS[0]!);
        setMonthlyRevenue(o.prefill.monthlyRevenue ? groupDigits(o.prefill.monthlyRevenue) : '');
      })
      .catch((e) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!options && !error) {
    return (
      <>
        <main className="flex flex-1 items-center justify-center p-6 text-sm text-ink-muted">
          {t('apply.loadingProducts')}
        </main>
        <PortalNav />
      </>
    );
  }

  if (options && options.products.length === 0) {
    return (
      <>
        <main className="flex flex-1 flex-col gap-3 p-5">
          <h1 className="m-0 font-display text-xl font-semibold">{t('apply.title')}</h1>
          <p className="m-0 text-sm text-ink-muted">{t('apply.noProducts')}</p>
          <Link href="/portal/home">
            <Button type="button" variant="secondary">
              {t('common.backHome')}
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
        <h1 className="m-0 font-display text-xl font-semibold">{t('apply.title')}</h1>

        {step !== 'sent' ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-xs text-ink-muted">
              {t('apply.stepOf', {
                n: step,
                title: t(
                  step === 1
                    ? 'apply.stepLoan'
                    : step === 2
                      ? 'apply.stepDetails'
                      : 'apply.stepReview',
                ),
              })}
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
            <h2 className="m-0 font-display text-lg font-semibold">{t('apply.sent')}</h2>
            <p className="m-0 text-sm text-ink-muted">
              {t('apply.sentBody', { amount: formatRwf(amountBig) })}
            </p>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-muted">{t('apply.reference')}</dt>
              <dd className="m-0 font-semibold">{result.code}</dd>
              <dt className="text-ink-muted">{t('apply.status')}</dt>
              <dd className="m-0">{result.status}</dd>
              <dt className="text-ink-muted">{t('apply.expectedDecision')}</dt>
              <dd className="m-0">{result.expected}</dd>
            </dl>
            <Button type="button" onClick={() => router.push('/portal/home')}>
              {t('common.backHome')}
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
                label={t('apply.product')}
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
              label={t('apply.amountRwf')}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(groupDigits(e.target.value))}
              required
            />
            <SelectField
              label={t('apply.termMonths')}
              value={String(termMonths)}
              onChange={(e) => setTermMonths(Number(e.target.value))}
            >
              {product.terms.map((months) => (
                <option key={months} value={months}>
                  {t('common.months', { n: months })}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={t('apply.purpose')}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            >
              {(options?.purposes?.length
                ? options.purposes
                : ['Equipment', 'Stock', 'Working capital']
              ).map((p) => (
                <option key={p} value={p}>
                  {option(p)}
                </option>
              ))}
            </SelectField>
            {quote ? (
              <div className="rounded-xl border border-line bg-surface p-4 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-ink-muted">{t('apply.monthlyInstalment')}</span>
                  <span className="font-semibold">
                    <Money amount={quote.monthly} />
                  </span>
                </div>
                <div className="mt-1 flex justify-between gap-3">
                  <span className="text-ink-muted">{t('apply.totalToRepay')}</span>
                  <span className="font-semibold">
                    <Money amount={quote.totalToRepay} />
                  </span>
                </div>
                <div className="mt-1 flex justify-between gap-3">
                  <span className="text-ink-muted">{t('apply.rate')}</span>
                  <span>{t('common.perYear', { rate: formatBps(quote.annualRateBps, 0) })}</span>
                </div>
                {quote.affordability && !quote.affordability.affordable ? (
                  <p className="m-0 mt-2 text-xs text-amber">
                    {t('apply.affordability', {
                      ratio: quote.affordability.ratio,
                      limit: quote.affordability.limit,
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}
            <Button type="submit" disabled={amountBig <= 0n}>
              {t('common.continue')}
            </Button>
            <p className="m-0 text-center text-xs text-ink-muted">{t('apply.noFees')}</p>
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
              label={t('apply.businessName')}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              maxLength={120}
            />
            <SelectField
              label={t('apply.sector')}
              value={businessSector}
              onChange={(e) => setBusinessSector(e.target.value)}
            >
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {option(s)}
                </option>
              ))}
            </SelectField>
            <TextField
              label={t('apply.monthlyRevenue')}
              inputMode="numeric"
              value={monthlyRevenue}
              onChange={(e) => setMonthlyRevenue(groupDigits(e.target.value))}
            />
            {!options?.prefill.kycVerified ? (
              <TextField
                label={t('apply.nationalIdNumber')}
                inputMode="numeric"
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value.replace(/\D/g, '').slice(0, 16))}
                maxLength={16}
              />
            ) : (
              <p className="m-0 text-sm text-ink-muted">
                {t('apply.idOnFile', { id: options.prefill.nationalIdMasked ?? '' })}
              </p>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={shareMomo}
                onChange={(e) => setShareMomo(e.target.checked)}
              />
              <span>
                {t('apply.shareMomo')}
                <span className="block text-xs text-ink-muted">{t('apply.shareMomoHint')}</span>
              </span>
            </label>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setStep(1)}>
                {t('common.back')}
              </Button>
              <Button type="submit">{t('common.continue')}</Button>
            </div>
          </form>
        ) : null}

        {step === 3 ? (
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="rounded-xl border border-line bg-surface p-4 text-sm">
              <p className="m-0 font-semibold">{product?.name}</p>
              <p className="m-0 mt-1 text-ink-muted">
                <Money amount={amountBig.toString()} /> · {t('common.months', { n: termMonths })} ·{' '}
                {option(purpose)}
              </p>
              {quote ? (
                <p className="m-0 mt-2">
                  {t('apply.monthlyInstalment')}: <Money amount={quote.monthly} />
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
              {t('apply.agreeTerms', { lender: lenderName })}
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={bureau}
                onChange={(e) => setBureau(e.target.checked)}
              />
              {t('apply.agreeBureau', { lender: lenderName })}
            </label>
            <FormError>{error}</FormError>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setStep(2)}>
                {t('common.back')}
              </Button>
              <Button type="submit" disabled={busy || !agreed}>
                {busy ? t('apply.sending') : t('apply.submit')}
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
