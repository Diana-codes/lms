import { describe, expect, it } from 'vitest';
import {
  BORROWER_MESSAGES,
  borrowerLanguage,
  formatDateIn,
  optionLabel,
  smsText,
  translate,
  translateApiMessage,
} from './i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('borrower wording', () => {
  it('has every English line in Kinyarwanda, with the same placeholders', () => {
    const en = BORROWER_MESSAGES.EN;
    const rw = BORROWER_MESSAGES.RW;
    expect(Object.keys(rw).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(rw[key].trim(), key).not.toBe('');
      expect(placeholders(rw[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('fills placeholders and keeps a missing one visible', () => {
    expect(translate('RW', 'home.instalmentOf', { n: 3, total: 12 })).toBe('Igice cya 3 muri 12');
    expect(translate('EN', 'home.instalmentOf', { n: 3 })).toBe('Instalment 3 of {total}');
  });

  it('narrows stored languages to ones the borrower screens support', () => {
    expect(borrowerLanguage('RW')).toBe('RW');
    expect(borrowerLanguage('FR')).toBe('EN');
    expect(borrowerLanguage(null)).toBe('EN');
  });

  it('labels English choice values without changing them', () => {
    expect(optionLabel('RW', 'Equipment')).toBe('Ibikoresho');
    expect(optionLabel('EN', 'Equipment')).toBe('Equipment');
    expect(optionLabel('RW', 'Boda boda')).toBe('Boda boda');
  });

  it('writes dates with Kinyarwanda month names', () => {
    expect(formatDateIn('RW', '2026-05-04')).toBe('4 Gicurasi 2026');
    expect(formatDateIn('RW', '2026-12-31T10:00:00.000Z', { year: false })).toBe('31 Ukuboza');
    expect(formatDateIn('EN', '2026-05-04')).toBe('4 May 2026');
  });

  it('translates known API messages and leaves the rest alone', () => {
    expect(translateApiMessage('RW', 'That code is not valid')).toBe('Iyo kode si yo');
    expect(translateApiMessage('RW', 'Your application AP-2026-0042 is still being reviewed')).toBe(
      'Ubusabe bwawe AP-2026-0042 buracyasuzumwa',
    );
    expect(translateApiMessage('RW', 'Something new')).toBe('Something new');
    expect(translateApiMessage('EN', 'That code is not valid')).toBe('That code is not valid');
  });
});

describe('SMS wording', () => {
  const v = {
    lender: 'Kora Lend',
    firstName: 'Aline',
    amount: 284_985n,
    loanCode: 'LN-2026-0001',
    date: '2026-05-04',
    payCode: '123456',
  };

  it('writes reminders in each language', () => {
    expect(smsText('EN', 'reminder.due_soon', v)).toBe(
      'Hello Aline, this is Kora Lend. Your instalment of RWF 284,985 on loan LN-2026-0001 is due on 4 May. Pay with MoMo Pay 123456. Thank you.',
    );
    expect(smsText('RW', 'reminder.due_soon', v)).toBe(
      'Muraho Aline, ni Kora Lend. Igice cyawe cya RWF 284,985 ku nguzanyo LN-2026-0001 kizishyurwa ku ya 4 Gicurasi. Ishyura ukoresheje MoMo Pay 123456. Murakoze.',
    );
  });

  it('keeps every message within three SMS segments', () => {
    const templates = [
      'reminder.due_soon',
      'reminder.overdue',
      'payment.received',
      'disbursement.sent',
      'application.received',
      'offer.preapproved',
      'checkin',
      'otp',
    ] as const;
    const long = {
      ...v,
      lender: 'Umurenge SACCO Nyarugenge',
      firstName: 'Jean-Bosco',
      amount: 99_999_999n,
      applicationCode: 'AP-2026-0001',
      code: '123456',
    };
    for (const lang of ['EN', 'RW'] as const) {
      for (const t of templates) {
        const text = smsText(lang, t, long);
        expect(text.length, `${lang} ${t}`).toBeLessThanOrEqual(480);
        expect(text, `${lang} ${t}`).not.toMatch(/undefined|\{/);
      }
    }
  });
});
