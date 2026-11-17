import { isRwNationalId } from '@kora/core';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, ApiError, errorMessage, saveTokens, type Tokens } from '../lib/api';
import type { RegistrationOptions } from '../lib/types';
import {
  Button,
  Checkbox,
  Choice,
  ErrorText,
  Muted,
  Panel,
  RoundButton,
  ScreenTitle,
  Sheet,
} from '../ui';
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, LockIcon } from '../ui/icons';
import { c, font } from '../ui/theme';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12, color: c['ink-muted'], fontFamily: font.body }}>{label}</Text>
      {children}
      {hint ? <Muted style={{ fontSize: 12 }}>{hint}</Muted> : null}
    </View>
  );
}

function Picker({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={[styles.input, { flexDirection: 'row', alignItems: 'center' }]}
    >
      <Text style={{ flex: 1, fontSize: 15, color: c.ink, fontFamily: font.body }}>{value}</Text>
      <ChevronDownIcon size={18} color={c['ink-muted']} />
    </Pressable>
  );
}

/** "1199080012345012" -> "1 1990 8 0012345 0 12", the way it is printed on the card. */
const spacedId = (digits: string) =>
  [
    digits.slice(0, 1),
    digits.slice(1, 5),
    digits.slice(5, 6),
    digits.slice(6, 13),
    digits.slice(13, 14),
    digits.slice(14, 16),
  ]
    .filter(Boolean)
    .join(' ');

/**
 * Sign up as a new customer, after proving the phone number with an SMS
 * code. The account starts unverified: an officer checks the ID before any
 * loan is approved.
 */
export function Register({
  registrationToken,
  phone,
  onDone,
  onCancel,
}: {
  registrationToken: string;
  /** Masked, for display. */
  phone: string;
  onDone: () => void;
  onCancel: (message?: string) => void;
}) {
  const [options, setOptions] = useState<RegistrationOptions | null>(null);
  const [fullName, setFullName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [sector, setSector] = useState<string | null>(null);
  const [branchCode, setBranchCode] = useState<string | null>(null);
  const [agreedData, setAgreedData] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [marketingSms, setMarketingSms] = useState(false);
  const [picker, setPicker] = useState<'sector' | 'branch' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<RegistrationOptions>('/app/auth/register', { auth: false })
      .then(setOptions)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const nameOk = /\S+\s+\S+/.test(fullName.trim());
  const idOk = isRwNationalId(nationalId);
  const ready = nameOk && idOk && branchCode && agreedData && agreedTerms && options;
  const branch = options?.branches.find((b) => b.code === branchCode);

  async function submit() {
    if (!options || !branchCode) return;
    setBusy(true);
    setError(null);
    try {
      await saveTokens(
        await api<Tokens>('/app/auth/register', {
          method: 'POST',
          auth: false,
          body: {
            registrationToken,
            fullName: fullName.trim(),
            nationalId,
            businessName: businessName.trim() || undefined,
            businessSector: businessName.trim() && sector ? sector : undefined,
            branchCode,
            agreedTerms,
            agreedDataProcessing: agreedData,
            marketingSms,
            consentVersion: options.consentVersion,
          },
        }),
      );
      onDone();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 401) onCancel(err.message);
      else setError(errorMessage(err));
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <View style={styles.header}>
        <RoundButton label="Back to sign in" onPress={() => onCancel()}>
          <ArrowLeftIcon size={18} color={c.ink} />
        </RoundButton>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, color: c['ink-muted'], fontFamily: font.body }}>
            New account
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <CheckIcon size={13} color={c['success-fg']} strokeWidth={3} />
            <Text style={{ fontSize: 13, color: c['success-fg'], fontFamily: font.semibold }}>
              {phone} confirmed
            </Text>
          </View>
        </View>
      </View>
      {!options && !error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.forest} />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <View style={{ gap: 6 }}>
              <ScreenTitle>Murakaza neza! Tell us about you</ScreenTitle>
              <Muted style={{ fontSize: 14, lineHeight: 20 }}>
                It takes two minutes. An officer will check your ID before your first loan.
              </Muted>
            </View>

            <Panel>
              <Field label="Full name, as on your ID">
                <TextInput
                  style={styles.input}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="e.g. Grace Mukamana"
                  placeholderTextColor={c['ink-muted']}
                  autoCapitalize="words"
                  autoComplete="name"
                  textContentType="name"
                  maxLength={120}
                  accessibilityLabel="Full name"
                />
              </Field>
              <Field
                label="National ID number"
                hint={
                  nationalId.length === 16 && !idOk
                    ? 'That does not look like a Rwandan ID number. Check the 16 digits.'
                    : 'The 16 digits on the front of your ID card.'
                }
              >
                <TextInput
                  style={[styles.input, { letterSpacing: 0.6 }]}
                  keyboardType="number-pad"
                  value={spacedId(nationalId)}
                  onChangeText={(v) => setNationalId(v.replace(/\D/g, '').slice(0, 16))}
                  placeholder="1 1990 8 0012345 0 12"
                  placeholderTextColor={c['ink-muted']}
                  maxLength={21}
                  accessibilityLabel="National ID number, 16 digits"
                />
              </Field>
            </Panel>

            <Panel>
              <Field label="Business name (optional)">
                <TextInput
                  style={styles.input}
                  value={businessName}
                  onChangeText={setBusinessName}
                  placeholder="e.g. Grace Tailoring"
                  placeholderTextColor={c['ink-muted']}
                  maxLength={120}
                  accessibilityLabel="Business name, optional"
                />
              </Field>
              {businessName.trim() ? (
                <Field label="Sector">
                  <Picker
                    label="Sector"
                    value={sector ?? 'Choose a sector'}
                    onPress={() => setPicker('sector')}
                  />
                </Field>
              ) : null}
              <Field label="Your nearest branch" hint="Your loan officer will be from this branch.">
                <Picker
                  label="Branch"
                  value={branch ? `${branch.name} · ${branch.district}` : 'Choose a branch'}
                  onPress={() => setPicker('branch')}
                />
              </Field>
            </Panel>

            <Panel style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <LockIcon size={14} color={c.forest} />
                <Text style={{ fontSize: 13, fontFamily: font.semibold, color: c.ink }}>
                  How we use your data
                </Text>
              </View>
              {options?.privacy.map((p) => (
                <View key={p} style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ color: c['ink-muted'], fontFamily: font.body }}>•</Text>
                  <Text style={styles.small}>{p}</Text>
                </View>
              ))}
            </Panel>

            <View style={{ gap: 10 }}>
              <Checkbox checked={agreedData} onChange={setAgreedData}>
                <Text style={styles.small}>
                  I agree that Kora Lend can use my data as described above.
                </Text>
              </Checkbox>
              <Checkbox checked={agreedTerms} onChange={setAgreedTerms}>
                <Text style={styles.small}>
                  The details I gave are true and the ID number is my own. I understand Kora Lend
                  will check them.
                </Text>
              </Checkbox>
              <Checkbox checked={marketingSms} onChange={setMarketingSms}>
                <Text style={styles.small}>
                  Send me SMS about new loan offers (optional, you can stop any time).
                </Text>
              </Checkbox>
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <ErrorText>{error}</ErrorText>
            <Button
              label={busy ? 'Opening your account…' : 'Create my account'}
              variant="lime"
              loading={busy}
              disabled={!ready}
              onPress={submit}
            />
          </View>
        </>
      )}

      <Sheet open={picker === 'sector'} onClose={() => setPicker(null)} title="Sector">
        <View style={{ gap: 8 }}>
          {options?.sectors.map((s) => (
            <Choice
              key={s}
              label={s}
              selected={s === sector}
              onPress={() => {
                setSector(s);
                setPicker(null);
              }}
            />
          ))}
        </View>
      </Sheet>
      <Sheet open={picker === 'branch'} onClose={() => setPicker(null)} title="Nearest branch">
        <View style={{ gap: 8 }}>
          {options?.branches.map((b) => (
            <Choice
              key={b.code}
              label={`${b.name} · ${b.district}`}
              selected={b.code === branchCode}
              onPress={() => {
                setBranchCode(b.code);
                setPicker(null);
              }}
            />
          ))}
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 16 },
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
  small: { flex: 1, fontSize: 13, lineHeight: 19, color: c['ink-soft'], fontFamily: font.body },
});
