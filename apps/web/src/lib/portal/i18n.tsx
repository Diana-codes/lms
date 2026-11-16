'use client';

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
import { cx } from '@kora/ui';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { hasPortalSession, PortalApiError, portalApi } from './api';

/**
 * The borrower portal's language. Before sign-in it is whatever the visitor
 * chose on this device; after sign-in the borrower's saved preference wins, and
 * changing it saves it on their account so SMS follow the same choice.
 */
const STORAGE_KEY = 'kl_borrower_language';

interface PortalI18n {
  lang: BorrowerLanguage;
  /** The lender's display name, for wording such as consent text. */
  lender: string;
  t: (key: MessageKey, vars?: MessageVars) => string;
  /** A calendar date (or ISO timestamp) in the borrower's language. */
  date: (iso: string, opts?: { year?: boolean }) => string;
  /** A stored English choice value, labelled in the borrower's language. */
  option: (value: string) => string;
  /** An error from the API, in the borrower's language where we know the wording. */
  error: (err: unknown) => string;
  /** Change language; saved on the account when signed in. */
  setLanguage: (lang: BorrowerLanguage) => Promise<void>;
  /** Follow the language the API says the account uses, without saving anything. */
  adopt: (lang: string | null | undefined) => void;
}

const Context = createContext<PortalI18n | null>(null);

function remembered(): BorrowerLanguage | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? borrowerLanguage(v) : null;
  } catch {
    return null;
  }
}

function remember(lang: BorrowerLanguage) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // private window: the choice lasts for this page only
  }
}

export function PortalLanguageProvider({
  initial = 'EN',
  lender,
  children,
}: {
  initial?: BorrowerLanguage;
  lender: string;
  children: React.ReactNode;
}) {
  const [lang, setLang] = useState<BorrowerLanguage>(initial);

  useEffect(() => {
    const saved = remembered();
    if (saved) setLang(saved);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'RW' ? 'rw' : 'en';
  }, [lang]);

  const adopt = useCallback((value: string | null | undefined) => {
    if (!value) return;
    const next = borrowerLanguage(value);
    setLang(next);
    remember(next);
  }, []);

  const setLanguage = useCallback(async (next: BorrowerLanguage) => {
    setLang(next);
    remember(next);
    if (hasPortalSession()) {
      await portalApi('/app/profile/language', { method: 'POST', body: { language: next } });
    }
  }, []);

  const value = useMemo<PortalI18n>(
    () => ({
      lang,
      lender,
      t: (key, vars) => translate(lang, key, vars),
      date: (iso, opts) => formatDateIn(lang, iso, opts),
      option: (v) => optionLabel(lang, v),
      error: (err) =>
        err instanceof PortalApiError
          ? translateApiMessage(lang, err.message)
          : translate(lang, 'error.generic'),
      setLanguage,
      adopt,
    }),
    [lang, lender, setLanguage, adopt],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePortalI18n(): PortalI18n {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('usePortalI18n needs a PortalLanguageProvider above it');
  return ctx;
}

/** Text that follows the borrower's language, for use inside server components. */
export function T({ k, vars }: { k: MessageKey; vars?: MessageVars }) {
  return <>{usePortalI18n().t(k, vars)}</>;
}

/** English / Ikinyarwanda switch. */
export function LanguageSwitch({ onSaved }: { onSaved?: (message: string) => void }) {
  const { lang, t, setLanguage, error } = usePortalI18n();
  const [busy, setBusy] = useState(false);
  return (
    <div
      role="group"
      aria-label={t('common.language')}
      className="inline-flex rounded-lg border border-line bg-surface p-0.5"
    >
      {(['EN', 'RW'] as const).map((option) => (
        <button
          key={option}
          type="button"
          lang={option === 'RW' ? 'rw' : 'en'}
          aria-pressed={lang === option}
          disabled={busy}
          onClick={async () => {
            if (option === lang) return;
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
          className={cx(
            'min-h-9 rounded-md px-3 text-sm font-semibold',
            lang === option ? 'bg-forest text-white' : 'text-ink-muted',
          )}
        >
          {LANGUAGE_NAMES[option]}
        </button>
      ))}
    </div>
  );
}
