import {
  BUSINESS_SECTORS,
  formatDate,
  formatRwf,
  formatRwfCompact,
  maskNationalId,
} from '@kora/core';
import Slider from '@react-native-community/slider';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, errorMessage, uploadFile } from '../lib/api';
import { preparePhoto, uploadErrorMessage } from '../lib/upload';
import type { AgreementPreview, ApplyOptions, Draft, Quote } from '../lib/types';
import {
  Button,
  Checkbox,
  Choice,
  DarkCard,
  ErrorText,
  Label,
  MomoTile,
  Muted,
  Panel,
  Row,
  ScreenTitle,
  Sheet,
  StepHeader,
  Toggle,
  tap,
} from '../ui';
import { CameraIcon, CheckIcon, ChevronDownIcon, IdCardIcon, LockIcon } from '../ui/icons';
import { c, font } from '../ui/theme';

const SECTORS: readonly string[] = BUSINESS_SECTORS;
const STEP = 100_000n;
const CONSENT_VERSION = '2026-01';
const groupDigits = (s: string) =>
  s
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function Footer({ children }: { children: React.ReactNode }) {
  return <View style={styles.footer}>{children}</View>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12, color: c['ink-muted'], fontFamily: font.body }}>{label}</Text>
      {children}
    </View>
  );
}

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
  // Accepting the agreement must be a deliberate tap, never pre-ticked.
  const [agreed, setAgreed] = useState(false);
  const [agreement, setAgreement] = useState<AgreementPreview | null>(null);
  const [readOpen, setReadOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sectorOpen, setSectorOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [result, setResult] = useState<{ code: string; status: string; expected: string } | null>(
    null,
  );

  useEffect(() => {
    api<ApplyOptions>('/app/apply/options')
      .then((o) => {
        setOptions(o);
        const product = o.products.find((p) => p.kind === 'SME') ?? o.products[0]!;
        const limit = o.preApprovedLimit ? BigInt(o.preApprovedLimit) : BigInt(product.maxAmount);
        const start = (limit / 2n / STEP) * STEP;
        setDraft({
          productCode: product.code,
          amount: start < BigInt(product.minAmount) ? BigInt(product.minAmount) : start,
          termMonths: product.terms.includes(12) ? 12 : product.terms[0]!,
          purpose: 'Equipment',
          businessName: o.prefill.businessName ?? '',
          businessSector:
            o.prefill.sector && SECTORS.includes(o.prefill.sector) ? o.prefill.sector : SECTORS[0]!,
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
  const min = product ? BigInt(product.minAmount) : 0n;
  const max = useMemo(() => {
    if (!product) return 0n;
    const cap = BigInt(product.maxAmount);
    const limit = options?.preApprovedLimit ? BigInt(options.preApprovedLimit) : cap;
    return limit < cap ? limit : cap;
  }, [product, options]);

  const amount = draft?.amount;
  const term = draft?.termMonths;
  const code = draft?.productCode;
  useEffect(() => {
    if (amount == null || term == null || !code) return;
    let live = true;
    const t = setTimeout(() => {
      api<Quote>(`/app/apply/quote?productCode=${code}&amount=${amount}&termMonths=${term}`)
        .then((q) => live && setQuote(q))
        .catch(() => live && setQuote(null));
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [amount, term, code]);

  // The Key Facts for exactly what is being applied for. New terms need a new tick.
  useEffect(() => {
    if (step !== 3 || amount == null || term == null || !code) return;
    let live = true;
    setAgreement(null);
    setAgreed(false);
    api<AgreementPreview>(
      `/app/apply/agreement?productCode=${code}&amount=${amount}&termMonths=${term}`,
    )
      .then((a) => live && setAgreement(a))
      .catch((err) => live && setError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, [step, amount, term, code]);

  async function pick(kind: 'id' | 'selfie') {
    setBusy(kind);
    try {
      const perm =
        kind === 'selfie'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast(
          kind === 'selfie'
            ? 'Allow camera access to take a selfie.'
            : 'Allow photo access to add your ID.',
        );
        return;
      }
      const picked =
        kind === 'selfie'
          ? await ImagePicker.launchCameraAsync({
              cameraType: ImagePicker.CameraType.front,
              quality: 0.7,
            })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (picked.canceled) return;
      const photo = await preparePhoto(picked.assets[0]!, kind);
      const r = await uploadFile<{ key: string }>(`/app/apply/upload/${kind}`, photo);
      setDraft((d) => d && { ...d, [kind === 'id' ? 'idPhotoKey' : 'selfieKey']: r.key });
    } catch (err) {
      toast(uploadErrorMessage(err));
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
          agreedBureau: agreed,
          consentVersion: CONSENT_VERSION,
          agreementVersion: agreement?.version,
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
        style={[
          styles.screen,
          { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
        ]}
      >
        <Muted style={{ fontSize: 14 }}>{error ?? 'Loading…'}</Muted>
        {error ? <Button label="Back" variant="outline" height={44} onPress={onCancel} /> : null}
      </View>
    );
  }

  const rate = `${(product.annualRateBps / 100).toFixed(0)}% p.a.`;
  const kycVerified = options.prefill.kycVerified;

  // ── Success ──
  if (step === 'sent' && result) {
    return (
      <View
        style={[
          styles.screen,
          { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 28, gap: 24 },
        ]}
      >
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              backgroundColor: c.lime,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CheckIcon size={44} color={c.forest} strokeWidth={2.6} />
          </View>
          <Text
            accessibilityRole="header"
            style={{ fontFamily: font.display, fontSize: 28, letterSpacing: -0.5, color: c.ink }}
          >
            Application sent
          </Text>
          <Text
            style={{
              textAlign: 'center',
              fontSize: 15,
              lineHeight: 22,
              color: c['ink-soft'],
              maxWidth: 300,
              fontFamily: font.body,
            }}
          >
            We’re reviewing your request for {formatRwf(draft.amount)}. We’ll send you an SMS as
            soon as there’s a decision.
          </Text>
          <Panel radius={18} style={{ width: '100%', gap: 10 }}>
            <Row label="Reference" value={result.code} valueStyle={{ fontFamily: font.semibold }} />
            <Row
              label="Status"
              value={result.status}
              valueStyle={{ fontFamily: font.semibold, color: c['info-fg'] }}
            />
            <Row
              label="Expected decision"
              value={result.expected}
              valueStyle={{ fontFamily: font.semibold }}
            />
          </Panel>
        </View>
        <Button label="Back to home" onPress={onDone} />
      </View>
    );
  }

  // ── Step 1: amount and term ──
  if (step === 1) {
    return (
      <View style={styles.screen}>
        <StepHeader step={1} title="Loan details" onBack={onCancel} />
        <ScrollView contentContainerStyle={styles.body}>
          <ScreenTitle>How much do you need?</ScreenTitle>
          <Panel radius={22} style={{ padding: 20 }}>
            <Text style={{ fontSize: 13, color: c['ink-muted'], fontFamily: font.body }}>
              Loan amount
            </Text>
            <Text
              accessibilityLiveRegion="polite"
              style={{
                fontFamily: font.display,
                fontSize: 36,
                letterSpacing: -0.7,
                color: c.ink,
                fontVariant: ['tabular-nums'],
              }}
            >
              {formatRwf(draft.amount)}
            </Text>
            <Slider
              accessibilityLabel="Loan amount"
              style={{ width: '100%', height: 32 }}
              minimumValue={Number(min)}
              maximumValue={Number(max)}
              step={Number(STEP)}
              value={Number(draft.amount)}
              onValueChange={(v) => setDraft((d) => d && { ...d, amount: BigInt(Math.round(v)) })}
              onSlidingComplete={() => tap()}
              minimumTrackTintColor={c.forest}
              maximumTrackTintColor={c.track}
              thumbTintColor={c.forest}
            />
            <View style={{ flexDirection: 'row' }}>
              <Muted style={{ flex: 1 }}>{formatRwfCompact(min)}</Muted>
              <Muted>
                {options.preApprovedLimit
                  ? `Pre-approved up to ${formatRwfCompact(max)}`
                  : `Up to ${formatRwfCompact(max)}`}
              </Muted>
            </View>
          </Panel>
          <View style={{ gap: 10 }}>
            <Text style={{ fontSize: 13, color: c['ink-muted'], fontFamily: font.body }}>
              Repay over
            </Text>
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
              {product.terms.slice(0, 4).map((t) => (
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
          <DarkCard>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontSize: 12, color: c['forest-muted'], fontFamily: font.body }}>
                  Monthly instalment
                </Text>
                <Text
                  style={{
                    fontFamily: font.display,
                    fontSize: 28,
                    color: c.lime,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {quote ? formatRwf(BigInt(quote.monthly)) : '…'}
                </Text>
              </View>
              <Text style={{ fontSize: 12, color: c['forest-muted'], fontFamily: font.body }}>
                {rate}
              </Text>
            </View>
            <View style={{ height: 1, backgroundColor: c.whiteSoft }} />
            <Row
              dark
              label="Total interest"
              value={quote ? formatRwf(BigInt(quote.totalInterest)) : '…'}
            />
            <Row
              dark
              label="Total to repay"
              value={quote ? formatRwf(BigInt(quote.totalToRepay)) : '…'}
            />
            <Row dark label="First payment" value={quote ? formatDate(quote.firstPayment) : '…'} />
            <Row
              dark
              label="Fee, taken from the payout"
              value={quote ? formatRwf(BigInt(quote.fee)) : '…'}
            />
            <Row
              dark
              label="You receive"
              value={quote ? formatRwf(BigInt(quote.youReceive)) : '…'}
              valueStyle={{ color: c.lime }}
            />
          </DarkCard>
          {quote?.affordability && !quote.affordability.affordable ? (
            <View style={{ backgroundColor: c['warning-bg'], borderRadius: 14, padding: 14 }}>
              <Text
                style={{
                  color: c['warning-fg'],
                  fontSize: 13,
                  lineHeight: 19,
                  fontFamily: font.body,
                }}
              >
                This would be {quote.affordability.ratio} of your income. We lend up to{' '}
                {quote.affordability.limit}, so try a smaller amount or a longer term.
              </Text>
            </View>
          ) : null}
        </ScrollView>
        <Footer>
          <Button label="Continue" onPress={() => setStep(2)} />
          <Muted style={{ textAlign: 'center' }}>
            No fees to apply · Decision within 1 working day
          </Muted>
        </Footer>
      </View>
    );
  }

  // ── Step 2: purpose, business, identity, statements ──
  if (step === 2) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <StepHeader step={2} title="Your details" onBack={() => setStep(1)} />
        <ScrollView
          contentContainerStyle={[styles.body, { gap: 18 }]}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenTitle>Tell us about your business</ScreenTitle>
          <View style={{ gap: 10 }}>
            <Label>What is the loan for?</Label>
            <View
              accessibilityRole="radiogroup"
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
            >
              {options.purposes.map((p) => (
                <Choice
                  key={p}
                  label={p}
                  pill
                  selected={p === draft.purpose}
                  onPress={() => setDraft({ ...draft, purpose: p })}
                />
              ))}
            </View>
          </View>
          <Panel>
            <Field label="Business name">
              <TextInput
                style={styles.input}
                value={draft.businessName}
                onChangeText={(v) => setDraft({ ...draft, businessName: v })}
                placeholder="e.g. Uwase Tailoring"
                placeholderTextColor={c['ink-muted']}
                accessibilityLabel="Business name"
              />
            </Field>
            <Field label="Sector">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Sector: ${draft.businessSector}`}
                onPress={() => setSectorOpen(true)}
                style={[styles.input, { flexDirection: 'row', alignItems: 'center' }]}
              >
                <Text style={{ flex: 1, fontSize: 15, color: c.ink, fontFamily: font.body }}>
                  {draft.businessSector}
                </Text>
                <ChevronDownIcon size={18} color={c['ink-muted']} />
              </Pressable>
            </Field>
            <Field label="Average monthly revenue (RWF)">
              <TextInput
                style={[styles.input, { fontVariant: ['tabular-nums'] }]}
                keyboardType="number-pad"
                value={draft.monthlyRevenue}
                onChangeText={(v) => setDraft({ ...draft, monthlyRevenue: groupDigits(v) })}
                placeholder="1,650,000"
                placeholderTextColor={c['ink-muted']}
                accessibilityLabel="Average monthly revenue in Rwandan francs"
              />
            </Field>
          </Panel>
          <Panel>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, fontSize: 13, fontFamily: font.semibold, color: c.ink }}>
                Identity
              </Text>
              {kycVerified ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    backgroundColor: c['success-bg'],
                    borderRadius: 999,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                  }}
                >
                  <CheckIcon size={12} color={c['success-fg']} strokeWidth={3} />
                  <Text style={{ fontSize: 11, fontFamily: font.semibold, color: c['success-fg'] }}>
                    Verified with NIDA
                  </Text>
                </View>
              ) : null}
            </View>
            <Field label="National ID number">
              {options.prefill.nationalIdMasked ? (
                <View
                  style={[styles.input, { justifyContent: 'center', backgroundColor: c.ground }]}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      color: c.ink,
                      letterSpacing: 0.6,
                      fontFamily: font.body,
                    }}
                  >
                    {options.prefill.nationalIdMasked}
                  </Text>
                </View>
              ) : (
                <TextInput
                  style={[styles.input, { letterSpacing: 0.6 }]}
                  keyboardType="number-pad"
                  maxLength={16}
                  value={draft.nationalId}
                  onChangeText={(v) => setDraft({ ...draft, nationalId: v.replace(/\D/g, '') })}
                  placeholder="16 digits"
                  placeholderTextColor={c['ink-muted']}
                  accessibilityLabel="National ID number"
                />
              )}
            </Field>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(
                [
                  ['id', draft.idPhotoKey, IdCardIcon, 'ID front · added', 'Add ID front'],
                  ['selfie', draft.selfieKey, CameraIcon, 'Selfie · added', 'Take a selfie'],
                ] as const
              ).map(([kind, done, Icon, doneLabel, label]) => (
                <Pressable
                  key={kind}
                  accessibilityRole="button"
                  onPress={() => pick(kind)}
                  disabled={busy === kind}
                  style={[styles.photo, done ? styles.photoDone : styles.photoEmpty]}
                >
                  <Icon size={22} color={done ? c['success-fg'] : c['ink-soft']} />
                  <Text
                    style={{
                      fontSize: 12,
                      color: done ? c['success-fg'] : c['ink-soft'],
                      fontFamily: font.body,
                    }}
                  >
                    {busy === kind ? 'Uploading…' : done ? doneLabel : label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Panel>
          <Panel style={{ gap: 10 }}>
            <Text style={{ fontSize: 13, fontFamily: font.semibold, color: c.ink }}>
              Statements
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <MomoTile />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontFamily: font.medium, color: c.ink }}>
                  Share 6 months of MoMo history
                </Text>
                <Muted>Faster decision, no upload needed</Muted>
              </View>
              <Toggle
                label="Share MoMo history"
                value={draft.shareMomoHistory}
                onChange={(v) => setDraft({ ...draft, shareMomoHistory: v })}
              />
            </View>
          </Panel>
        </ScrollView>
        <Footer>
          <Button label="Review application" onPress={() => setStep(3)} />
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <LockIcon size={13} color={c['ink-muted']} />
            <Muted>Your data is encrypted and only used for this application</Muted>
          </View>
        </Footer>
        <Sheet open={sectorOpen} onClose={() => setSectorOpen(false)} title="Sector">
          <View style={{ gap: 8 }}>
            {SECTORS.map((s) => (
              <Choice
                key={s}
                label={s}
                selected={s === draft.businessSector}
                onPress={() => {
                  setDraft({ ...draft, businessSector: s });
                  setSectorOpen(false);
                }}
              />
            ))}
          </View>
        </Sheet>
      </KeyboardAvoidingView>
    );
  }

  // ── Step 3: review and submit ──
  return (
    <View style={styles.screen}>
      <StepHeader step={3} title="Review & submit" onBack={() => setStep(2)} />
      <ScrollView contentContainerStyle={[styles.body, { gap: 16 }]}>
        <ScreenTitle>Check everything looks right</ScreenTitle>
        <DarkCard style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text
              style={{ flex: 1, fontSize: 12, color: c['forest-muted'], fontFamily: font.body }}
            >
              You’re borrowing
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setStep(1)} hitSlop={10}>
              <Text style={{ fontSize: 13, fontFamily: font.semibold, color: c.lime }}>Edit</Text>
            </Pressable>
          </View>
          <Text
            style={{
              fontFamily: font.display,
              fontSize: 34,
              letterSpacing: -0.7,
              color: c.surface,
              fontVariant: ['tabular-nums'],
            }}
          >
            {formatRwf(draft.amount)}
          </Text>
          <View style={{ height: 1, backgroundColor: c.whiteSoft }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 }}>
            {(
              [
                ['Monthly', quote ? formatRwf(BigInt(quote.monthly)) : '…', true],
                ['Term', `${draft.termMonths} months · ${rate}`, false],
                ['Total interest', quote ? formatRwf(BigInt(quote.totalInterest)) : '…', false],
                ['Total to repay', quote ? formatRwf(BigInt(quote.totalToRepay)) : '…', false],
              ] as const
            ).map(([label, value, lime]) => (
              <View key={label} style={{ width: '50%', gap: 2 }}>
                <Text style={{ fontSize: 13, color: c['forest-muted'], fontFamily: font.body }}>
                  {label}
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    fontFamily: font.semibold,
                    color: lime ? c.lime : c.surface,
                  }}
                >
                  {value}
                </Text>
              </View>
            ))}
          </View>
        </DarkCard>
        <Panel style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, fontSize: 13, fontFamily: font.semibold, color: c.ink }}>
              Your details
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setStep(2)} hitSlop={10}>
              <Text style={{ fontSize: 13, fontFamily: font.semibold, color: c.forest }}>Edit</Text>
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
              kycVerified
                ? 'Verified'
                : draft.nationalId
                  ? maskNationalId(draft.nationalId)
                  : 'Not given'
            }
            valueStyle={kycVerified ? { color: c['positive-fg'] } : undefined}
          />
        </Panel>
        <Panel style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <MomoTile />
          <View style={{ flex: 1 }}>
            <Muted>Money goes to</Muted>
            <Text style={{ fontSize: 14, fontFamily: font.semibold, color: c.ink }}>
              {options.wallet ?? 'No wallet linked yet'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setWalletOpen(true)}
            style={styles.change}
          >
            <Text style={{ fontSize: 13, fontFamily: font.semibold, color: c.ink }}>Change</Text>
          </Pressable>
        </Panel>
        <Panel style={{ gap: 10 }}>
          <Text style={{ fontSize: 13, fontFamily: font.semibold, color: c.ink }}>Key Facts</Text>
          {agreement ? (
            agreement.keyFacts.map((f) => (
              <View key={f.label} style={styles.fact}>
                <Text style={styles.factLabel}>{f.label}</Text>
                <Text style={styles.factValue}>{f.value}</Text>
              </View>
            ))
          ) : (
            <Muted>Loading the Key Facts…</Muted>
          )}
          <Button
            label="Read the full agreement"
            variant="outline"
            height={46}
            disabled={!agreement}
            onPress={() => setReadOpen(true)}
          />
        </Panel>
        <Checkbox checked={agreed} onChange={setAgreed}>
          <Text
            style={{ fontSize: 13, lineHeight: 20, color: c['ink-soft'], fontFamily: font.body }}
          >
            I have read the Key Facts and agree to the{' '}
            <Text
              style={{ fontFamily: font.semibold, color: c.forest }}
              onPress={() => agreement && setReadOpen(true)}
            >
              loan agreement
            </Text>
            , and I allow Kora Lend to check my credit record with the credit bureau.
          </Text>
        </Checkbox>
        <ErrorText>{error}</ErrorText>
      </ScrollView>
      <Footer>
        <Button
          label="Submit application"
          variant="lime"
          disabled={!agreed || !agreement}
          loading={busy === 'submit'}
          onPress={submit}
        />
        <Muted style={{ textAlign: 'center' }}>You’ll get a decision within 1 working day</Muted>
      </Footer>
      <Sheet open={readOpen} onClose={() => setReadOpen(false)} title="Loan agreement">
        {agreement ? <AgreementText body={agreement.body} /> : null}
        <Button label="Close" variant="dark" height={48} onPress={() => setReadOpen(false)} />
      </Sheet>
      <Sheet
        open={walletOpen}
        onClose={() => setWalletOpen(false)}
        title="Where should the money go?"
      >
        <View style={{ gap: 10 }}>
          <View
            style={[
              styles.walletOption,
              { borderColor: c.forest, borderWidth: 2, backgroundColor: c['success-bg'] },
            ]}
          >
            <MomoTile />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: font.semibold, color: c.ink }}>
                {options.wallet ?? 'MTN MoMo'}
              </Text>
              <Muted>
                {options.wallet ? 'Linked to your account' : 'Ask your officer to link your wallet'}
              </Muted>
            </View>
          </View>
          {(['Airtel Money', 'Bank account'] as const).map((w) => (
            <View key={w} style={[styles.walletOption, { opacity: 0.55 }]}>
              <View
                style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.ground }}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontFamily: font.semibold, color: c.ink }}>{w}</Text>
                <Muted>Coming soon</Muted>
              </View>
            </View>
          ))}
        </View>
        <Button label="Done" variant="outline" height={48} onPress={() => setWalletOpen(false)} />
      </Sheet>
    </View>
  );
}

/** The agreement text, laid out the way the PDF lays it out. */
function AgreementText({ body }: { body: string }) {
  return (
    <View style={{ gap: 8 }}>
      {body.split('\n').map((raw, i) => {
        const line = raw.trimEnd();
        if (!line) return null;
        if (line.startsWith('# '))
          return (
            <Text key={i} style={{ fontFamily: font.display, fontSize: 20, color: c.forest }}>
              {line.slice(2)}
            </Text>
          );
        if (line.startsWith('## '))
          return (
            <Text
              key={i}
              accessibilityRole="header"
              style={{ fontFamily: font.semibold, fontSize: 15, color: c.forest, marginTop: 8 }}
            >
              {line.slice(3)}
            </Text>
          );
        if (line.startsWith('| ')) {
          const [label, value] = line.slice(2).split(' | ');
          return (
            <View key={i} style={styles.fact}>
              <Text style={styles.factLabel}>{label}</Text>
              <Text style={styles.factValue}>{value}</Text>
            </View>
          );
        }
        const draft = line.startsWith('DRAFT');
        return (
          <Text
            key={i}
            style={{
              fontSize: 14,
              lineHeight: 21,
              color: draft ? c['danger-fg'] : c['ink-soft'],
              fontFamily: draft ? font.semibold : font.body,
            }}
          >
            {line}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fact: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  factLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: c['ink-muted'],
    fontFamily: font.body,
  },
  factValue: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: c.ink,
    fontFamily: font.semibold,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  screen: { flex: 1, backgroundColor: c.ground },
  body: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 16, gap: 20 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 8,
    backgroundColor: c.ground,
    borderTopWidth: 1,
    borderTopColor: c.divider,
  },
  input: {
    height: 46,
    borderWidth: 1,
    borderColor: c.field,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 15,
    color: c.ink,
    backgroundColor: c.surface,
    fontFamily: font.body,
  },
  photo: {
    flex: 1,
    height: 88,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoEmpty: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: c.dashed,
    backgroundColor: c.surface,
  },
  photoDone: { borderWidth: 1, borderColor: c['lime-deep'], backgroundColor: c['paid-row'] },
  change: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.field,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 16,
    padding: 12,
  },
});
