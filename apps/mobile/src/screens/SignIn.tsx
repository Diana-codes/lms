import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, errorMessage, saveTokens, type Tokens } from '../lib/api';
import type { RegistrationNeeded } from '../lib/types';
import { Button, ErrorText, Muted } from '../ui';
import { BfMark } from '../ui/BfMark';
import { c, font } from '../ui/theme';

export function SignIn({
  onSignedIn,
  onRegister,
  notice,
}: {
  onSignedIn: () => void;
  /** The number is confirmed but has no account yet. */
  onRegister: (r: RegistrationNeeded) => void;
  /** Shown above the form, e.g. when a sign-up expired. */
  notice?: string | null;
}) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [masked, setMasked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ phone: string; otpRequired?: boolean } & Partial<Tokens>>(
        '/app/auth/request-code',
        { method: 'POST', body: { phone }, auth: false },
      );
      // The lender has sign-in codes off: a known number is signed in straight away.
      if (r.otpRequired === false && r.accessToken && r.refreshToken) {
        await saveTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken });
        onSignedIn();
        return;
      }
      setMasked(r.phone);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<Tokens | RegistrationNeeded>('/app/auth/verify', {
        method: 'POST',
        body: { phone, code },
        auth: false,
      });
      if ('registrationToken' in r) {
        onRegister(r);
        return;
      }
      await saveTokens(r);
      onSignedIn();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <View style={styles.hero}>
        <View style={styles.logo}>
          <BfMark size={40} />
        </View>
        <Text
          style={{ color: c.surface, fontFamily: font.display, fontSize: 32, letterSpacing: -0.6 }}
        >
          Bridge to Finance
        </Text>
        <Text
          style={{ color: c['forest-muted'], fontSize: 15, lineHeight: 22, fontFamily: font.body }}
        >
          Loans for your business, repaid with MoMo.
        </Text>
      </View>
      <View style={styles.form}>
        <Text
          accessibilityRole="header"
          style={{ fontFamily: font.display, fontSize: 24, color: c.ink, letterSpacing: -0.4 }}
        >
          {masked ? 'Enter your code' : 'Muraho! Sign in or sign up'}
        </Text>
        <Muted style={{ fontSize: 14, lineHeight: 20 }}>
          {masked
            ? `We sent a 6-digit code by SMS to ${masked}.`
            : 'Enter your phone number and we will text you a 6-digit code. No password needed.'}
        </Muted>
        {!masked && notice ? <ErrorText>{notice}</ErrorText> : null}
        {masked ? (
          <TextInput
            accessibilityLabel="6-digit code"
            style={[
              styles.input,
              { fontSize: 28, letterSpacing: 10, textAlign: 'center', fontFamily: font.display },
            ]}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={6}
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
            autoFocus
          />
        ) : (
          <View style={[styles.input, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
            <Text style={{ fontSize: 17, color: c['ink-muted'], fontFamily: font.medium }}>
              🇷🇼 +250
            </Text>
            <View style={{ width: 1, height: 24, backgroundColor: c.line }} />
            <TextInput
              accessibilityLabel="Phone number"
              style={{ flex: 1, fontSize: 18, color: c.ink, fontFamily: font.body, height: '100%' }}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              placeholder="788 123 412"
              placeholderTextColor={c['ink-muted']}
              value={phone}
              onChangeText={setPhone}
              autoFocus
            />
          </View>
        )}
        <ErrorText>{error}</ErrorText>
        <Button
          label={busy ? 'One moment…' : masked ? 'Sign in' : 'Send me a code'}
          variant="lime"
          loading={busy}
          disabled={masked ? code.length !== 6 : phone.replace(/\D/g, '').length < 9}
          onPress={masked ? verify : requestCode}
        />
        {masked ? (
          <Button
            label="Use a different number"
            variant="ghost"
            height={44}
            onPress={() => {
              setMasked(null);
              setCode('');
              setError(null);
            }}
          />
        ) : (
          <Muted style={{ textAlign: 'center' }}>
            New to Bridge to Finance? Use the same steps: after the code we will ask a few details
            to open your account.
          </Muted>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.forest },
  hero: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 24, paddingBottom: 28, gap: 8 },
  logo: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  form: {
    backgroundColor: c.ground,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 32,
    gap: 16,
  },
  input: {
    height: 56,
    borderWidth: 1,
    borderColor: c.field,
    borderRadius: 14,
    backgroundColor: c.surface,
    paddingHorizontal: 16,
    fontSize: 18,
    color: c.ink,
    fontFamily: font.body,
  },
});
