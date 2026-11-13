import { formatDate, formatRwf, formatRwfCompact, maskNationalId } from '@kora/core';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { api, errorMessage } from '../lib/api';
import type { ApplyOptions, Draft, Quote } from '../lib/types';
import { Button, Choice, ErrorText, Heading, Muted, Row } from '../ui';
import { c, font, r } from '../ui/theme';

const SECTORS = ['Garments & tailoring', 'Retail shop', 'Agriculture', 'Transport', 'Other'];
const STEP_ROUND = 100_000n;
const CONSENT_VERSION = '2026-01';

function Progress({ step, title }: { step: 1 | 2 | 3; title: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Muted>
        Step {step} of 3 · {title}
      </Muted>
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
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
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
  }, []);

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
        <Text style={{ color: c['ink-muted'] }}>{error ?? 'Loading…'}</Text>
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
          <Heading>Application sent</Heading>
          <Text style={{ textAlign: 'center', color: c['ink-soft'], fontSize: 14, lineHeight: 20 }}>
            We’re reviewing your request for {formatRwf(draft.amount)}. We’ll send you an SMS as
            soon as there’s a decision.
          </Text>
        </View>
        <View style={styles.box}>
          <Row label="Reference" value={result.code} />
          <Row label="Status" value={result.status} />
          <Row label="Expected decision" value={result.expected} />
        </View>
        <Button label="Back to home" variant="accent" onPress={onDone} />
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
          <Header step={1} title="Loan details" onBack={onCancel} />
          <ScrollView contentContainerStyle={styles.body}>
            <Heading>How much do you need?</Heading>
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
              <Muted>Loan amount</Muted>
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
                    ? `Pre-approved up to ${formatRwfCompact(max)}`
                    : `Up to ${formatRwfCompact(max)}`}
                </Muted>
              </View>
            </View>
            <View style={{ gap: 8 }}>
              <Muted>Repay over</Muted>
              <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
                {product.terms.map((t) => (
                  <Choice
                    key={t}
                    label={`${t} mo`}
                    selected={t === draft.termMonths}
                    onPress={() => setDraft({ ...draft, termMonths: t })}
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
                  <Muted>Monthly instalment</Muted>
                  <Text style={{ fontFamily: font.display, fontSize: 24, color: c.ink }}>
                    {quote ? formatRwf(BigInt(quote.monthly)) : '…'}
                  </Text>
                </View>
                <Muted>{(product.annualRateBps / 100).toFixed(0)}% p.a.</Muted>
              </View>
              <View style={{ height: 1, backgroundColor: c['line-soft'] }} />
              <Row
                label="Total interest"
                value={quote ? formatRwf(BigInt(quote.totalInterest)) : '…'}
              />
              <Row
                label="Total to repay"
                value={quote ? formatRwf(BigInt(quote.totalToRepay)) : '…'}
              />
              <Row label="First payment" value={quote ? formatDate(quote.firstPayment) : '…'} />
              {quote?.affordability && !quote.affordability.affordable ? (
                <Text style={{ color: c['warning-fg'], fontSize: 13 }}>
                  This would be {quote.affordability.ratio} of your income; we lend up to{' '}
                  {quote.affordability.limit}. Try a smaller amount or a longer term.
                </Text>
              ) : null}
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <Button label="Continue" variant="accent" onPress={() => setStep(2)} />
            <Muted style={{ textAlign: 'center' }}>
              No fees to apply · Decision within 1 working day
            </Muted>
          </View>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Header step={2} title="Your details" onBack={() => setStep(1)} />
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Heading>Tell us about your business</Heading>
            <View style={{ gap: 8 }}>
              <Muted>What is the loan for?</Muted>
              <View
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
                accessibilityRole="radiogroup"
              >
                {options.purposes.map((p) => (
                  <Choice
                    key={p}
                    label={p}
                    selected={p === draft.purpose}
                    onPress={() => setDraft({ ...draft, purpose: p })}
                    style={{ borderRadius: r.pill }}
                  />
                ))}
              </View>
            </View>
            <View style={styles.box}>
              <Field label="Business name">
                <TextInput
                  style={styles.input}
                  value={draft.businessName}
                  onChangeText={(v) => setDraft({ ...draft, businessName: v })}
                  placeholder="e.g. Uwase Tailoring"
                  placeholderTextColor={c['ink-muted']}
                />
              </Field>
              <Field label="Sector">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {SECTORS.map((s) => (
                    <Choice
                      key={s}
                      label={s}
                      selected={s === draft.businessSector}
                      onPress={() => setDraft({ ...draft, businessSector: s })}
                      style={{ borderRadius: r.pill, minHeight: 40 }}
                    />
                  ))}
                </View>
              </Field>
              <Field label="Average monthly revenue (RWF)">
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
                <Text style={{ fontFamily: font.semibold, color: c.ink }}>Identity</Text>
                {options.prefill.kycVerified ? (
                  <Text
                    style={{ color: c['positive-fg'], fontSize: 12, fontFamily: font.semibold }}
                  >
                    ✓ Verified with NIDA
                  </Text>
                ) : null}
              </View>
              <Field label="National ID number">
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
                    placeholder="16 digits"
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
                      ? 'Uploading…'
                      : draft.idPhotoKey
                        ? 'ID front · added'
                        : 'Add ID photo'}
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
                      ? 'Uploading…'
                      : draft.selfieKey
                        ? 'Selfie · added'
                        : 'Take a selfie'}
                  </Text>
                </Pressable>
              </View>
              {!options.prefill.kycVerified && !draft.idPhotoKey ? (
                <Muted>An ID photo and a selfie let us verify you faster.</Muted>
              ) : null}
            </View>
            <View style={styles.box}>
              <Text style={{ fontFamily: font.semibold, color: c.ink }}>Statements</Text>
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
                    Share 6 months of MoMo history
                  </Text>
                  <Muted>Faster decision, no upload needed</Muted>
                </View>
                <Switch
                  accessibilityLabel="Share MoMo history"
                  value={draft.shareMomoHistory}
                  onValueChange={(v) => setDraft({ ...draft, shareMomoHistory: v })}
                  trackColor={{ true: c.forest, false: c.line }}
                  thumbColor={draft.shareMomoHistory ? c.lime : c.surface}
                />
              </View>
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <Button label="Review application" variant="accent" onPress={() => setStep(3)} />
            <Muted style={{ textAlign: 'center' }}>
              🔒 Your data is encrypted and only used for this application
            </Muted>
          </View>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <Header step={3} title="Review & submit" onBack={() => setStep(2)} />
          <ScrollView contentContainerStyle={styles.body}>
            <Heading>Check everything looks right</Heading>
            <View style={styles.box}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Muted>You’re borrowing</Muted>
                <Pressable onPress={() => setStep(1)} hitSlop={10}>
                  <Text style={{ color: c.forest, fontFamily: font.semibold, fontSize: 13 }}>
                    Edit
                  </Text>
                </Pressable>
              </View>
              <Text style={{ fontFamily: font.display, fontSize: 30, color: c.ink }}>
                {formatRwf(draft.amount)}
              </Text>
              <View style={{ height: 1, backgroundColor: c['line-soft'] }} />
              <Row label="Monthly" value={quote ? formatRwf(BigInt(quote.monthly)) : '…'} />
              <Row
                label="Term"
                value={`${draft.termMonths} months · ${(product.annualRateBps / 100).toFixed(0)}% p.a.`}
              />
              <Row
                label="Total interest"
                value={quote ? formatRwf(BigInt(quote.totalInterest)) : '…'}
              />
              <Row
                label="Total to repay"
                value={quote ? formatRwf(BigInt(quote.totalToRepay)) : '…'}
              />
            </View>
            <View style={styles.box}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Muted>Your details</Muted>
                <Pressable onPress={() => setStep(2)} hitSlop={10}>
                  <Text style={{ color: c.forest, fontFamily: font.semibold, fontSize: 13 }}>
                    Edit
                  </Text>
                </Pressable>
              </View>
              <Row label="Purpose" value={draft.purpose} />
              <Row label="Business" value={draft.businessName || '—'} />
              <Row
                label="Monthly revenue"
                value={draft.monthlyRevenue ? `RWF ${draft.monthlyRevenue}` : '—'}
              />
              <Row
                label="National ID"
                value={
                  options.prefill.kycVerified
                    ? 'Verified'
                    : draft.nationalId
                      ? maskNationalId(draft.nationalId)
                      : 'Not given'
                }
              />
              <Row
                label="MoMo history"
                value={draft.shareMomoHistory ? 'Shared (6 months)' : 'Not shared'}
              />
            </View>
            <View style={styles.box}>
              <Text style={{ fontFamily: font.semibold, color: c.ink }}>Money goes to</Text>
              <Row
                label="Wallet"
                value={options.wallet ?? 'No MoMo wallet linked · ask your officer'}
              />
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
                I agree to the loan terms and to Kora Lend processing my data for this application.
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
                Kora Lend may check my credit record with the credit bureau.
              </Text>
            </Pressable>
            <ErrorText>{error}</ErrorText>
          </ScrollView>
          <View style={styles.footer}>
            <Button
              label="Submit application"
              variant="accent"
              disabled={!agreed}
              loading={busy === 'submit'}
              onPress={submit}
            />
            <Muted style={{ textAlign: 'center' }}>
              You’ll get a decision within 1 working day
            </Muted>
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
