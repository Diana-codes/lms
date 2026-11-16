import { formatBps, formatRwf, kigaliDate, type MessageKey } from '@kora/core';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, clearTokens } from '../lib/api';
import { LanguageSwitch, useI18n } from '../lib/i18n';
import type { Profile, Schedule as ScheduleData } from '../lib/types';
import { Button, Card, Heading, Money, Muted, Pill, Row } from '../ui';
import { c, font, r } from '../ui/theme';

function Top({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.top}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        onPress={onBack}
        style={styles.back}
      >
        <Text style={{ fontSize: 20, color: c.ink }}>‹</Text>
      </Pressable>
      <Heading size={22}>{title}</Heading>
    </View>
  );
}

const STATE_TONE = {
  PAID: 'success',
  PARTIAL: 'warning',
  OVERDUE: 'danger',
  DUE_NEXT: 'lime',
  UPCOMING: 'neutral',
} as const;
export function Schedule({ loanCode, onBack }: { loanCode: string; onBack: () => void }) {
  const { t, date, error: errorMessage } = useI18n();
  const [data, setData] = useState<ScheduleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ScheduleData>(`/app/loans/${loanCode}/schedule`)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [loanCode, errorMessage]);
  return (
    <View style={styles.screen}>
      <Top title={t('schedule.title')} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        {error ? <Muted>{error}</Muted> : null}
        {data ? (
          <Card style={{ gap: 0 }}>
            <Muted style={{ marginBottom: 8 }}>
              {t('schedule.rateLine', {
                code: loanCode,
                amount: formatRwf(BigInt(data.principal)),
                rate: formatBps(data.annualRateBps, 0),
              })}
            </Muted>
            {data.rows.map((row) => (
              <View key={row.number} style={styles.scheduleRow}>
                <Text style={{ width: 24, color: c['ink-muted'], fontVariant: ['tabular-nums'] }}>
                  {row.number}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.ink, fontFamily: font.medium }}>{date(row.dueDate)}</Text>
                  {row.state === 'PARTIAL' ||
                  (row.state === 'OVERDUE' && row.remaining !== row.amount) ? (
                    <Muted>{t('common.left', { amount: formatRwf(BigInt(row.remaining)) })}</Muted>
                  ) : null}
                </View>
                <Money
                  amount={row.amount}
                  style={{ fontFamily: font.semibold, color: c.ink, marginRight: 10 }}
                />
                <Pill label={t(`state.${row.state}` as MessageKey)} tone={STATE_TONE[row.state]} />
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

export function ProfileScreen({
  onBack,
  onSignedOut,
}: {
  onBack: () => void;
  onSignedOut: () => void;
}) {
  const { t, lender, error: errorMessage, adopt } = useI18n();
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Profile>('/app/profile')
      .then((p) => {
        adopt(p.language);
        setData(p);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [adopt, errorMessage]);

  async function signOut() {
    try {
      await api('/app/auth/logout', { method: 'POST' });
    } catch {
      // already gone
    }
    await clearTokens();
    onSignedOut();
  }

  async function withdraw(type: 'MOMO_HISTORY') {
    await api('/app/profile/consents/withdraw', { method: 'POST', body: { type } });
    setData(await api<Profile>('/app/profile'));
  }

  return (
    <View style={styles.screen}>
      <Top title={t('profile.title')} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        {error ? <Muted>{error}</Muted> : null}
        {data ? (
          <>
            <Card>
              <Text style={{ fontFamily: font.display, fontSize: 20, color: c.ink }}>
                {data.name}
              </Text>
              <Row label={t('profile.customerNumber')} value={data.code} />
              <Row label={t('profile.phone')} value={data.phone} />
              {data.nationalId ? (
                <Row label={t('profile.nationalId')} value={data.nationalId} />
              ) : null}
              <Row
                label={t('profile.identity')}
                value={
                  <Pill
                    label={
                      data.kycStatus === 'VERIFIED' ? t('profile.verified') : t('profile.pending')
                    }
                    tone={data.kycStatus === 'VERIFIED' ? 'success' : 'warning'}
                  />
                }
              />
              {data.business ? (
                <Row label={t('profile.business')} value={data.business.name} />
              ) : null}
            </Card>
            <Card>
              <Text style={{ fontFamily: font.semibold, color: c.ink }}>
                {t('common.language')}
              </Text>
              <LanguageSwitch onSaved={setNotice} />
              <Muted>{notice ?? t('common.languageHint')}</Muted>
            </Card>
            <Card>
              <Text style={{ fontFamily: font.semibold, color: c.ink }}>{t('profile.loans')}</Text>
              {data.loans.length === 0 ? <Muted>{t('profile.noLoans')}</Muted> : null}
              {data.loans.map((l) => (
                <Row
                  key={l.code}
                  label={`${l.code} · ${l.productName}`}
                  value={`${formatRwf(BigInt(l.principal))} · ${t(`loanStatus.${l.status}` as MessageKey)}`}
                />
              ))}
            </Card>
            <Card>
              <Text style={{ fontFamily: font.semibold, color: c.ink }}>
                {t('profile.yourData')}
              </Text>
              <Muted>{t('profile.dataNote', { lender })}</Muted>
              {data.consents.some((x) => x.type === 'MOMO_HISTORY') ? (
                <Button
                  label={t('profile.stopMomo')}
                  variant="secondary"
                  onPress={() => withdraw('MOMO_HISTORY')}
                />
              ) : (
                <Muted>{t('profile.momoNotShared')}</Muted>
              )}
            </Card>
            <Button label={t('profile.signOut')} variant="secondary" onPress={signOut} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

export function Notifications({ onBack }: { onBack: () => void }) {
  const { t, date } = useI18n();
  const [items, setItems] = useState<Array<{
    id: string;
    title: string;
    at: string;
    read: boolean;
  }> | null>(null);
  useEffect(() => {
    api<Array<{ id: string; title: string; at: string; read: boolean }>>('/app/notifications')
      .then(setItems)
      .catch(() => setItems([]));
  }, []);
  return (
    <View style={styles.screen}>
      <Top title={t('alerts.title')} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        {items?.length === 0 ? <Muted>{t('alerts.empty')}</Muted> : null}
        {items?.map((n) => (
          <View key={n.id} style={[styles.note, !n.read && { borderColor: c['lime-deep'] }]}>
            <Text style={{ color: c.ink, fontFamily: font.medium }}>{n.title}</Text>
            <Muted>{date(kigaliDate(new Date(n.at)))}</Muted>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, paddingBottom: 8 },
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
  body: { padding: 20, gap: 16, paddingBottom: 40 },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: c['line-soft'],
  },
  note: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: r.panel,
    padding: 14,
    gap: 4,
  },
});
