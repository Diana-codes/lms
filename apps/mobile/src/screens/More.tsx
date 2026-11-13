import { formatDate, formatRwf } from '@kora/core';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, clearTokens, errorMessage } from '../lib/api';
import type { Profile, Schedule as ScheduleData } from '../lib/types';
import { Button, Card, Heading, Money, Muted, Pill, Row } from '../ui';
import { c, font, r } from '../ui/theme';

function Top({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.top}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
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
const STATE_LABEL = {
  PAID: 'Paid',
  PARTIAL: 'Part paid',
  OVERDUE: 'Overdue',
  DUE_NEXT: 'Due next',
  UPCOMING: 'Upcoming',
} as const;

export function Schedule({ loanCode, onBack }: { loanCode: string; onBack: () => void }) {
  const [data, setData] = useState<ScheduleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ScheduleData>(`/app/loans/${loanCode}/schedule`)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [loanCode]);
  return (
    <View style={styles.screen}>
      <Top title="Repayment schedule" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        {error ? <Muted>{error}</Muted> : null}
        {data ? (
          <Card style={{ gap: 0 }}>
            <Muted style={{ marginBottom: 8 }}>
              {loanCode} · {formatRwf(BigInt(data.principal))} at{' '}
              {(data.annualRateBps / 100).toFixed(0)}% p.a.
            </Muted>
            {data.rows.map((row) => (
              <View key={row.number} style={styles.scheduleRow}>
                <Text style={{ width: 24, color: c['ink-muted'], fontVariant: ['tabular-nums'] }}>
                  {row.number}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.ink, fontFamily: font.medium }}>
                    {formatDate(row.dueDate)}
                  </Text>
                  {row.state === 'PARTIAL' ||
                  (row.state === 'OVERDUE' && row.remaining !== row.amount) ? (
                    <Muted>{formatRwf(BigInt(row.remaining))} left</Muted>
                  ) : null}
                </View>
                <Money
                  amount={row.amount}
                  style={{ fontFamily: font.semibold, color: c.ink, marginRight: 10 }}
                />
                <Pill label={STATE_LABEL[row.state]} tone={STATE_TONE[row.state]} />
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
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Profile>('/app/profile')
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, []);

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
      <Top title="Profile" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        {error ? <Muted>{error}</Muted> : null}
        {data ? (
          <>
            <Card>
              <Text style={{ fontFamily: font.display, fontSize: 20, color: c.ink }}>
                {data.name}
              </Text>
              <Row label="Customer number" value={data.code} />
              <Row label="Phone" value={data.phone} />
              {data.nationalId ? <Row label="National ID" value={data.nationalId} /> : null}
              <Row
                label="Identity"
                value={
                  <Pill
                    label={data.kycStatus === 'VERIFIED' ? 'Verified' : 'Pending'}
                    tone={data.kycStatus === 'VERIFIED' ? 'success' : 'warning'}
                  />
                }
              />
              {data.business ? <Row label="Business" value={data.business.name} /> : null}
            </Card>
            <Card>
              <Text style={{ fontFamily: font.semibold, color: c.ink }}>Your loans</Text>
              {data.loans.length === 0 ? <Muted>None yet.</Muted> : null}
              {data.loans.map((l) => (
                <Row
                  key={l.code}
                  label={`${l.code} · ${l.productName}`}
                  value={`${formatRwf(BigInt(l.principal))} · ${l.status === 'ACTIVE' ? 'Active' : l.status === 'REPAID' ? 'Repaid' : l.status === 'PENDING_DISBURSEMENT' ? 'Sending' : 'Closed'}`}
                />
              ))}
            </Card>
            <Card>
              <Text style={{ fontFamily: font.semibold, color: c.ink }}>Your data</Text>
              <Muted>
                Kora Lend keeps your data in Rwanda and uses it only to manage your loans. You can
                withdraw permissions here at any time.
              </Muted>
              {data.consents.some((x) => x.type === 'MOMO_HISTORY') ? (
                <Button
                  label="Stop sharing MoMo history"
                  variant="secondary"
                  onPress={() => withdraw('MOMO_HISTORY')}
                />
              ) : (
                <Muted>MoMo history: not shared.</Muted>
              )}
            </Card>
            <Button label="Sign out" variant="secondary" onPress={signOut} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

export function Notifications({ onBack }: { onBack: () => void }) {
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
      <Top title="Notifications" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        {items?.length === 0 ? <Muted>Nothing yet.</Muted> : null}
        {items?.map((n) => (
          <View key={n.id} style={[styles.note, !n.read && { borderColor: c['lime-deep'] }]}>
            <Text style={{ color: c.ink, fontFamily: font.medium }}>{n.title}</Text>
            <Muted>{formatDate(n.at.slice(0, 10))}</Muted>
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
