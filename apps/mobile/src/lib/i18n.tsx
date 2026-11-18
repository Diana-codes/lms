import {
  type BorrowerLanguage,
  borrowerLanguage,
  formatDateIn,
  LANGUAGE_NAMES,
  type MessageKey,
  type MessageVars,
  optionLabel,
  translate,
  translateApiMessage,
} from '@kora/core';
import { storage } from './storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { c, font, r } from '../ui/theme';
import { api, ApiError, hasSession } from './api';

/**
 * The app's language. Before sign-in it is what was chosen on this phone;
 * after sign-in the borrower's saved preference wins, and changing it saves it
 * on their account so SMS follow the same choice.
 */
const STORAGE_KEY = 'kl_language';
/** The lender this build of the app belongs to. */
export const LENDER_NAME = process.env.EXPO_PUBLIC_LENDER_NAME ?? 'Bridge to Finance';

interface AppI18n {
  lang: BorrowerLanguage;
  lender: string;
  t: (key: MessageKey, vars?: MessageVars) => string;
  date: (iso: string, opts?: { year?: boolean }) => string;
  option: (value: string) => string;
  error: (err: unknown) => string;
  setLanguage: (lang: BorrowerLanguage) => Promise<void>;
  adopt: (lang: string | null | undefined) => void;
}

const Context = createContext<AppI18n | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<BorrowerLanguage>('EN');

  useEffect(() => {
    storage
      .get(STORAGE_KEY)
      .then((v) => v && setLang(borrowerLanguage(v)))
      .catch(() => undefined);
  }, []);

  const keep = useCallback((next: BorrowerLanguage) => {
    setLang(next);
    storage.set(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const adopt = useCallback(
    (value: string | null | undefined) => {
      if (value) keep(borrowerLanguage(value));
    },
    [keep],
  );

  const setLanguage = useCallback(
    async (next: BorrowerLanguage) => {
      keep(next);
      if (await hasSession()) {
        await api('/app/profile/language', { method: 'POST', body: { language: next } });
      }
    },
    [keep],
  );

  const value = useMemo<AppI18n>(
    () => ({
      lang,
      lender: LENDER_NAME,
      t: (key, vars) => translate(lang, key, vars),
      date: (iso, opts) => formatDateIn(lang, iso, opts),
      option: (v) => optionLabel(lang, v),
      error: (err) =>
        err instanceof ApiError
          ? translateApiMessage(lang, err.message)
          : translate(lang, 'error.generic'),
      setLanguage,
      adopt,
    }),
    [lang, setLanguage, adopt],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): AppI18n {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useI18n needs a LanguageProvider above it');
  return ctx;
}

/** English / Ikinyarwanda switch. */
export function LanguageSwitch({
  onSaved,
  dark,
}: {
  onSaved?: (message: string) => void;
  dark?: boolean;
}) {
  const { lang, t, setLanguage, error } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('common.language')}
      style={styles.group}
    >
      {(['EN', 'RW'] as const).map((option) => {
        const selected = lang === option;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: busy }}
            disabled={busy}
            onPress={async () => {
              if (selected) return;
              setBusy(true);
              try {
                await setLanguage(option);
                onSaved?.(translate(option, 'common.languageSaved'));
              } catch (err) {
                onSaved?.(error(err));
              } finally {
                setBusy(false);
              }
            }}
            style={[
              styles.option,
              dark && { borderColor: 'rgba(255,255,255,0.25)' },
              selected && { backgroundColor: dark ? c.lime : c.forest, borderColor: 'transparent' },
            ]}
          >
            <Text
              style={{
                fontFamily: font.semibold,
                fontSize: 13,
                color: selected ? (dark ? c.forest : c.surface) : dark ? c.surface : c.ink,
              }}
            >
              {LANGUAGE_NAMES[option]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', gap: 8 },
  option: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: r.pill,
    borderWidth: 1,
    borderColor: c.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
