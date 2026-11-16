import { formatBps, formatRwf, formatRwfCompact, maskNationalId } from '@kora/core';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import type { ApplyOptions, Draft, Quote } from '../lib/types';
import { Button, Choice, ErrorText, Heading, Muted, Row } from '../ui';
import { c, font, r } from '../ui/theme';

const SECTORS = ['Garments & tailoring', 'Retail shop', 'Agriculture', 'Transport', 'Other'];
const STEP_ROUND = 100_000n;
const CONSENT_VERSION = '2026-01';

function Progress({ step, title }: { step: 1 | 2 | 3; title: string }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: 6 }}>
      <Muted>{t('apply.stepOf', { n: step, title })}</Muted>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3].map((i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: i <= step ? c.forest : c.line,
            }}
          />
        ))}
      </View>
    </View>
  );
}

function Header({ step, title, onBack }: { step: 1 | 2 | 3; title: string; onBack: () => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        onPress={onBack}
        style={styles.back}
      >
        <Text style={{ fontSize: 20, color: c.ink }}>‹</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Progress step={step} title={title} />
      </View>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12, color: c['ink-muted'] }}>{label}</Text>
      {children}
    </View>
  );
}

const groupDigits = (s: string) => s.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function Apply({
  onDone,
  onCancel,
  toast,
}: {
  onDone: () => void;
  onCancel: () => void;
  toast: (m: string) => void;
}) {
  const { t, date, option, lender, error: errorMessage } = useI18n();
  const [options, setOptions] = useState<ApplyOptions | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 'sent'>(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [bureau, setBureau] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ code: string; status: string; expected: string } | null>(
    null,
  );

  useEffect(() => {
    api<ApplyOptions>('/app/apply/options')
      .then((o) => {
        setOptions(o);
        const product = o.products[0]!;
        const max = o.preApprovedLimit ? BigInt(o.preApprovedLimit) : BigInt(product.maxAmount);
        setDraft({
          productCode: product.code,
          amount: (max / 2n / STEP_ROUND) * STEP_ROUND || BigInt(product.minAmount),
          termMonths: product.terms.includes(12) ? 12 : product.terms[0]!,
          purpose: 'Equipment',
          businessName: o.prefill.businessName ?? '',
          businessSector: o.prefill.sector ?? SECTORS[0]!,
          monthlyRevenue: o.prefill.monthlyRevenue ? groupDigits(o.prefill.monthlyRevenue) : '',
          nationalId: '',
          shareMomoHistory: true,
          idPhotoKey: null,
          selfieKey: null,
        });
      })
      .catch((err) => setError(errorMessage(err)));
  }, [errorMessage]);

  const product = useMemo(
    () => options?.products.find((p) => p.code === draft?.productCode) ?? null,
    [options, draft?.productCode],
  );
  const max = useMemo(() => {
    if (!product) return 0n;
    const limit = options?.preApprovedLimit
      ? BigInt(options.preApprovedLimit)
      : BigInt(product.maxAmount);
    return limit < BigInt(product.maxAmount) ? limit : BigInt(product.maxAmount);
  }, [product, options]);
  const min = product ? BigInt(product.minAmount) : 0n;

  useEffect(() => {
    if (!draft || !product) return;
    let live = true;
    const t = setTimeout(() => {
      api<Quote>(
        `/app/apply/quote?productCode=${draft.productCode}&amount=${draft.amount}&termMonths=${draft.termMonths}`,
      )
        .then((q) => live && setQuote(q))
        .catch(() => live && setQuote(null));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [draft?.amount, draft?.termMonths, draft?.productCode, product, draft]);

  async function pick(kind: 'id' | 'selfie') {
    setBusy(kind);
    try {
      const picked =
        kind === 'selfie'
          ? await ImagePicker.launchCameraAsync({
              cameraType: ImagePicker.CameraType.front,
              quality: 0.7,
            })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (picked.canceled) return;
      const asset = picked.assets[0]!;
      const form = new FormData();
      form.append('file', {
        uri: asset.uri,
        name: kind === 'id' ? 'id.jpg' : 'selfie.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      } as unknown as Blob);
      const r = await api<{ key: string }>(`/app/apply/upload/${kind}`, { method: 'POST', form });
      setDraft((d) => d && { ...d, [kind === 'id' ? 'idPhotoKey' : 'selfieKey']: r.key });
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!draft) return;
    setBusy('submit');
    setError(null);
    try {
      const r = await api<{ code: string; status: string; expected: string }>('/app/apply', {
        method: 'POST',
        body: {
          productCode: draft.productCode,
          amount: draft.amount.toString(),
          termMonths: draft.termMonths,
          purpose: draft.purpose,
          businessName: draft.businessName.trim() || undefined,
          businessSector: draft.businessSector || undefined,
          monthlyRevenue: draft.monthlyRevenue.replace(/,/g, '') || undefined,
          nationalId: draft.nationalId.replace(/\s/g, '') || undefined,
          shareMomoHistory: draft.shareMomoHistory,
          agreedTerms: agreed,
          agreedBureau: bureau,
          consentVersion: CONSENT_VERSION,
          idPhotoKey: draft.idPhotoKey ?? undefined,
          selfieKey: draft.selfieKey ?? undefined,
        },
      });
      setResult(r);
      setStep('sent');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (!options || !draft || !product) {
    return (
      <View
        style={[styles.screen, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}
      >
        <Text style={{ color: c['ink-muted'] }}>{error ?? t('common.loading')}</Text>
      </View>
    );
  }

  if (step === 'sent' && result) {
    return (
      <View style={[styles.screen, { padding: 24, justifyContent: 'center', gap: 16 }]}>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: c.lime,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 28, color: c.forest }}>✓</Text>
          </View>
          <Heading>{t('apply.sent')}</Heading>
          <Text style={{ textAlign: 'center', color: c['ink-soft'], fontSize: 14, lineHeight: 20 }}>
            {t('apply.sentBody', { amount: formatRwf(draft.amount) })}
          </Text>
        </View>
        <View style={styles.box}>
          <Row label={t('apply.reference')} value={result.code} />
          <Row label={t('apply.status')} value={result.status} />
          <Row label={t('apply.expectedDecision')} value={result.expected} />
        </View>
        <Button label={t('common.backHome')} variant="accent" onPress={onDone} />
      </View>
    );
  }

  const adjust = (delta: bigint) =>
    setDraft({
      ...draft,
      amount:
        draft.amount + delta < min ? min : draft.amount + delta > max ? max : draft.amount + delta,
    });

  return (
    <View style={styles.screen}>
      {step === 1 ? (
        <>
          <Header step={1} title={t('apply.stepLoan')} onBack={onCancel} />
          <ScrollView contentContainerStyle={styles.body}>
            <Heading>{t('apply.howMuch')}</Heading>
            {options.products.length > 1 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {options.products.map((p) => (
                  <Choice
                    key={p.code}
                    label={p.name}
                    selected={p.code === draft.productCode}
                    onPress={() =>
                      setDraft({
                        ...draft,
                        productCode: p.code,
                        termMonths: p.terms.includes(draft.termMonths)
                          ? draft.termMonths
                          : p.terms[0]!,
                      })
                    }
                    style={{ borderRadius: r.pill, minHeight: 40 }}
                  />
                ))}
              </View>
            ) : null}
            <View style={styles.box}>
              <Muted>{t('apply.loanAmount')}</Muted>
              <Text
                accessibilityLiveRegion="polite"
                style={{ fontFamily: font.display, fontSize: 34, color: c.ink }}
              >
                {formatRwf(draft.amount)}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  label="− 100K"
                  variant="secondary"
                  onPress={() => adjust(-STEP_ROUND)}
                  style={{ flex: 1, minHeight: 48 }}
                  disabled={draft.amount <= min}
                />
                <Button
                  label="+ 100K"
                  variant="secondary"
                  onPress={() => adjust(STEP_ROUND)}
                  style={{ flex: 1, minHeight: 48 }}
                  disabled={draft.amount >= max}
                />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Muted>{formatRwfCompact(min)}</Muted>
                <Muted>
                  {options.preApprovedLimit
                    ? t('apply.preApprovedUpTo', { amount: formatRwfCompact(max) })
                    : t('common.upTo', { amount: formatRwfCompact(max) })}
                </Muted>
              </View>
            </View>
            <View style={{ gap: 8 }}>
              <Muted>{t('apply.repayOver')}</Muted>
              <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
                {product.terms.map((months) => (
                  <Choice
                    key={months}
                    label={t('common.monthsShort', { n: months })}
                    selected={months === draft.termMonths}
                    onPress={() => setDraft({ ...draft, termMonths: months })}
                    style={{ flex: 1 }}
                  />
                ))}
              </View>
            </View>
            <View style={styles.box}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'flex-end',
                }}
              >
                <View>
                  <Muted>{t('apply.monthlyInstalment')}</Muted>
                  <Text style={{ fontFamily: font.display, fontSize: 24, color: c.ink }}>
                    {quote ? formatRwf(BigInt(quote.monthly)) : '…'}
                  </Text>
                </View>
                <Muted>{t('common.perYear', { rate: formatBps(product.annualRateBps, 0) })}</Muted>
              </View>
              <View style={{ height: 1, backgroundColor: c['line-soft'] }} />
              <Row
                label={t('apply.totalInterest')}
                value={quote ? formatRwf(BigInt(quote.totalInterest)) : '…'}
              />
              <Row
                label={t('apply.totalToRepay')}
                value={quote ? formatRwf(BigInt(quote.totalToRepay)) : '…'}
              />
              <Row label={t('apply.firstPayment')} value={quote ? date(quote.firstPayment) : '…'} />
              {quote?.affordability && !quote.affordability.affordable ? (
                <Text style={{ color: c['warning-fg'], fontSize: 13 }}>
                  {t('apply.affordability', {
                    ratio: quote.affordability.ratio,
                    limit: quote.affordability.limit,
                  })}
                </Text>
              ) : null}
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <Button label={t('common.continue')} variant="accent" onPress={() => setStep(2)} />
            <Muted style={{ textAlign: 'center' }}>{t('apply.noFees')}</Muted>
          </View>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Header step={2} title={t('apply.stepDetails')} onBack={() => setStep(1)} />
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Heading>{t('apply.aboutBusiness')}</Heading>
            <View style={{ gap: 8 }}>
              <Muted>{t('apply.purpose')}</Muted>
              <View
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
                accessibilityRole="radiogroup"
              >
                {options.purposes.map((p) => (
                  <Choice
                    key={p}
                    label={option(p)}
                    selected={p === draft.purpose}
                    onPress={() => setDraft({ ...draft, purpose: p })}
                    style={{ borderRadius: r.pill }}
                  />
                ))}
              </View>
            </View>
            <View style={styles.box}>
              <Field label={t('apply.businessName')}>
                <TextInput
                  style={styles.input}
                  value={draft.businessName}
                  onChangeText={(v) => setDraft({ ...draft, businessName: v })}
                  placeholder={t('apply.businessNamePlaceholder')}
                  placeholderTextColor={c['ink-muted']}
                />
              </Field>
              <Field label={t('apply.sector')}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {SECTORS.map((s) => (
                    <Choice
                      key={s}
                      label={option(s)}
                      selected={s === draft.businessSector}
                      onPress={() => setDraft({ ...draft, businessSector: s })}
                      style={{ borderRadius: r.pill, minHeight: 40 }}
                    />
                  ))}
                </View>
              </Field>
              <Field label={t('apply.monthlyRevenue')}>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  value={draft.monthlyRevenue}
                  onChangeText={(v) => setDraft({ ...draft, monthlyRevenue: groupDigits(v) })}
                  placeholder="1,650,000"
                  placeholderTextColor={c['ink-muted']}
                />
              </Field>
            </View>
            <View style={styles.box}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontFamily: font.semibold, color: c.ink }}>
                  {t('apply.identity')}
                </Text>
                {options.prefill.kycVerified ? (
                  <Text
                    style={{ color: c['positive-fg'], fontSize: 12, fontFamily: font.semibold }}
                  >
                    {t('apply.verifiedNida')}
                  </Text>
                ) : null}
              </View>
              <Field label={t('apply.nationalIdNumber')}>
                {options.prefill.nationalIdMasked ? (
                  <Text style={[styles.input, { paddingTop: 14, color: c['ink-muted'] }]}>
                    {options.prefill.nationalIdMasked}
                  </Text>
                ) : (
                  <TextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    maxLength={16}
                    value={draft.nationalId}
                    onChangeText={(v) => setDraft({ ...draft, nationalId: v.replace(/\D/g, '') })}
                    placeholder={t('apply.digits16')}
                    placeholderTextColor={c['ink-muted']}
                  />
                )}
              </Field>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => pick('id')}
                  style={[styles.photo, draft.idPhotoKey && styles.photoDone]}
                  disabled={busy === 'id'}
                >
                  <Text style={{ fontSize: 20 }}>🪪</Text>
                  <Text style={{ fontSize: 12, color: c.ink, textAlign: 'center' }}>
                    {busy === 'id'
                      ? t('apply.uploading')
                      : draft.idPhotoKey
                        ? t('apply.idAdded')
                        : t('apply.addId')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => pick('selfie')}
                  style={[styles.photo, draft.selfieKey && styles.photoDone]}
                  disabled={busy === 'selfie'}
                >
                  <Text style={{ fontSize: 20 }}>🤳</Text>
                  <Text style={{ fontSize: 12, color: c.ink, textAlign: 'center' }}>
                    {busy === 'selfie'
                      ? t('apply.uploading')
                      : draft.selfieKey
                        ? t('apply.selfieAdded')
                        : t('apply.takeSelfie')}
                  </Text>
                </Pressable>
              </View>
              {!options.prefill.kycVerified && !draft.idPhotoKey ? (
                <Muted>{t('apply.photosHint')}</Muted>
              ) : null}
            </View>
            <View style={styles.box}>
              <Text style={{ fontFamily: font.semibold, color: c.ink }}>
                {t('apply.statements')}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    backgroundColor: '#FFCC00',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 10, fontFamily: font.semibold }}>MoMo</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: c.ink, fontFamily: font.medium }}>
                    {t('apply.shareMomo')}
                  </Text>
                  <Muted>{t('apply.shareMomoHint')}</Muted>
                </View>
                <Switch
                  accessibilityLabel={t('apply.shareMomo')}
                  value={draft.shareMomoHistory}
                  onValueChange={(v) => setDraft({ ...draft, shareMomoHistory: v })}
                  trackColor={{ true: c.forest, false: c.line }}
                  thumbColor={draft.shareMomoHistory ? c.lime : c.surface}
                />
              </View>
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <Button
              label={t('apply.reviewApplication')}
              variant="accent"
              onPress={() => setStep(3)}
            />
            <Muted style={{ textAlign: 'center' }}>{t('apply.encrypted')}</Muted>
          </View>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <Header step={3} title={t('apply.stepReview')} onBack={() => setStep(2)} />
          <ScrollView contentContainerStyle={styles.body}>
            <Heading>{t('apply.checkEverything')}</Heading>
            <View style={styles.box}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Muted>{t('apply.borrowing')}</Muted>
                <Pressable onPress={() => setStep(1)} hitSlop={10}>
                  <Text style={{ color: c.forest, fontFamily: font.semibold, fontSize: 13 }}>
                    {t('common.edit')}
                  </Text>
                </Pressable>
              </View>
              <Text style={{ fontFamily: font.display, fontSize: 30, color: c.ink }}>
                {formatRwf(draft.amount)}
              </Text>
              <View style={{ height: 1, backgroundColor: c['line-soft'] }} />
              <Row
                label={t('apply.monthly')}
                value={quote ? formatRwf(BigInt(quote.monthly)) : '…'}
              />
              <Row
                label={t('apply.term')}
                value={`${t('common.months', { n: draft.termMonths })} · ${t('common.perYear', {
                  rate: formatBps(product.annualRateBps, 0),
                })}`}
              />
              <Row
                label={t('apply.totalInterest')}
                value={quote ? formatRwf(BigInt(quote.totalInterest)) : '…'}
              />
              <Row
                label={t('apply.totalToRepay')}
                value={quote ? formatRwf(BigInt(quote.totalToRepay)) : '…'}
              />
            </View>
            <View style={styles.box}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Muted>{t('apply.yourDetails')}</Muted>
                <Pressable onPress={() => setStep(2)} hitSlop={10}>
                  <Text style={{ color: c.forest, fontFamily: font.semibold, fontSize: 13 }}>
                    {t('common.edit')}
                  </Text>
                </Pressable>
              </View>
              <Row label={t('apply.purposeShort')} value={option(draft.purpose)} />
              <Row label={t('profile.business')} value={draft.businessName || '—'} />
              <Row
                label={t('apply.monthlyRevenueShort')}
                value={draft.monthlyRevenue ? `RWF ${draft.monthlyRevenue}` : '—'}
              />
              <Row
                label={t('profile.nationalId')}
                value={
                  options.prefill.kycVerified
                    ? t('profile.verified')
                    : draft.nationalId
                      ? maskNationalId(draft.nationalId)
                      : t('common.notGiven')
                }
              />
              <Row
                label={t('apply.momoHistory')}
                value={draft.shareMomoHistory ? t('apply.sharedSix') : t('apply.notShared')}
              />
            </View>
            <View style={styles.box}>
              <Text style={{ fontFamily: font.semibold, color: c.ink }}>
                {t('apply.moneyGoesTo')}
              </Text>
              <Row label={t('apply.wallet')} value={options.wallet ?? t('apply.noWallet')} />
            </View>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              onPress={() => setAgreed((v) => !v)}
              style={styles.check}
            >
              <View
                style={[
                  styles.checkbox,
                  agreed && { backgroundColor: c.forest, borderColor: c.forest },
                ]}
              >
                {agreed ? <Text style={{ color: c.lime, fontSize: 14 }}>✓</Text> : null}
              </View>
              <Text style={{ flex: 1, fontSize: 14, color: c.ink, lineHeight: 20 }}>
                {t('apply.agreeTerms', { lender })}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: bureau }}
              onPress={() => setBureau((v) => !v)}
              style={styles.check}
            >
              <View
                style={[
                  styles.checkbox,
                  bureau && { backgroundColor: c.forest, borderColor: c.forest },
                ]}
              >
                {bureau ? <Text style={{ color: c.lime, fontSize: 14 }}>✓</Text> : null}
              </View>
              <Text style={{ flex: 1, fontSize: 14, color: c.ink, lineHeight: 20 }}>
                {t('apply.agreeBureau', { lender })}
              </Text>
            </Pressable>
            <ErrorText>{error}</ErrorText>
          </ScrollView>
          <View style={styles.footer}>
            <Button
              label={t('apply.submit')}
              variant="accent"
              disabled={!agreed}
              loading={busy === 'submit'}
              onPress={submit}
            />
            <Muted style={{ textAlign: 'center' }}>{t('apply.decisionWithin')}</Muted>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, paddingBottom: 8 },
  back: {
    width: 44,
    height: 44,
    borderRadius: r.control,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: 20, gap: 16, paddingBottom: 24 },
  footer: {
    padding: 20,
    paddingTop: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: c.line,
    backgroundColor: c.ground,
  },
  box: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: r.card,
    padding: 18,
    gap: 12,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: r.control,
    paddingHorizontal: 12,
    fontSize: 15,
    color: c.ink,
    backgroundColor: c.surface,
  },
  photo: {
    flex: 1,
    minHeight: 88,
    borderRadius: r.panel,
    borderWidth: 1,
    borderColor: c.line,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: c.ground,
  },
  photoDone: {
    borderStyle: 'solid',
    borderColor: c['lime-deep'],
    backgroundColor: c['success-bg'],
  },
  check: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', minHeight: 44 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: c.line,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -2,
  },
});
