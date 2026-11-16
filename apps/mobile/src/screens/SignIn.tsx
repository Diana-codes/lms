import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, errorMessage, saveTokens, type Tokens } from '../lib/api';
import { Button, ErrorText, Heading, Muted } from '../ui';
import { c, font, r } from '../ui/theme';

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [masked, setMasked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<
        | ({ otpRequired: false; phone: string } & Tokens)
        | { otpRequired: true; sent: true; phone: string }
      >('/app/auth/request-code', {
        method: 'POST',
        body: { phone },
        auth: false,
      });
      if (r.otpRequired === false) {
        await saveTokens(r);
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
      await saveTokens(
        await api<Tokens>('/app/auth/verify', {
          method: 'POST',
          body: { phone, code },
          auth: false,
        }),
      );
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
          <Text style={{ color: c.forest, fontFamily: font.display, fontSize: 22 }}>K</Text>
        </View>
        <Text style={{ color: c.surface, fontFamily: font.display, fontSize: 28 }}>Kora Lend</Text>
        <Text style={{ color: c['forest-muted'], fontSize: 14, marginTop: 4 }}>
          Loans for your business, paid with MoMo.
        </Text>
      </View>
      <View style={styles.form}>
        <Heading size={22}>{masked ? 'Enter your code' : 'Sign in with your phone'}</Heading>
        <Muted>
          {masked
            ? `We sent a 6-digit code by SMS to ${masked}.`
            : 'Enter the phone number on your account. You may get a texted code if your lender requires one.'}
        </Muted>
        {masked ? (
          <TextInput
            accessibilityLabel="6-digit code"
            style={[styles.input, { fontSize: 24, letterSpacing: 6, textAlign: 'center' }]}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={6}
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
            autoFocus
          />
        ) : (
          <TextInput
            accessibilityLabel="Phone number"
            style={styles.input}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            placeholder="078 812 3412"
            placeholderTextColor={c['ink-muted']}
            value={phone}
            onChangeText={setPhone}
            autoFocus
          />
        )}
        <ErrorText>{error}</ErrorText>
        <Button
          label={busy ? 'One moment…' : masked ? 'Sign in' : 'Continue'}
          loading={busy}
          disabled={masked ? code.length !== 6 : phone.replace(/\D/g, '').length < 9}
          onPress={masked ? verify : requestCode}
        />
        {masked ? (
          <Button
            label="Use a different number"
            variant="ghost"
            onPress={() => {
              setMasked(null);
              setCode('');
              setError(null);
            }}
          />
        ) : null}
        <Muted style={{ textAlign: 'center' }}>
          Only customers of Kora Lend can sign in. Not a customer yet? Visit a branch.
        </Muted>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.forest },
  hero: { flex: 1, justifyContent: 'flex-end', padding: 24, gap: 6 },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: c.lime,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  form: {
    backgroundColor: c.ground,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 36,
    gap: 14,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: r.control,
    backgroundColor: c.surface,
    paddingHorizontal: 14,
    fontSize: 18,
    color: c.ink,
    fontFamily: font.body,
  },
});
