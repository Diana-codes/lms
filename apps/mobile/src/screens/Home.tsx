import { formatDate, formatRwf } from '@kora/core';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, errorMessage } from '../lib/api';
import type { Home as HomeData } from '../lib/types';
import { Button, Card, Money, Muted, Pill, Row } from '../ui';
import { c, font, r } from '../ui/theme';

export function Home({
  go,
  toast,
}: {
  go: (screen: 'apply' | 'schedule' | 'profile' | 'notifications') => void;
  toast: (m: string) => void;
}) {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<HomeData>('/app/home'));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmPay() {
    if (!data?.loan) return;
    setPaying(true);
    try {
      const r = await api<{ paymentId: string }>(`/app/loans/${data.loan.code}/pay`, {
        method: 'POST',
        body: {},
      });
      setSheet(false);
      toast('Check your phone for the MoMo prompt and enter your PIN to approve.');
      // Follow up for a short while; the payment also settles on its own.
      for (let i = 0; i < 10; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        const s = await api<{ status: string; failureReason: string | null }>(
          `/app/payments/${r.paymentId}`,
        );
        if (s.status === 'SUCCESSFUL') {
          toast('Payment received. Thank you!');
          break;
        }
        if (s.status === 'FAILED') {
          toast(s.failureReason ?? 'The payment did not go through.');
          break;
        }
      }
      await load();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setPaying(false);
    }
  }

  if (!data) {
    return (
      <View
        style={[styles.screen, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}
      >
        <Text style={{ color: c['ink-muted'] }}>{error ?? 'Loading…'}</Text>
        {error ? (
          <Button label="Try again" variant="secondary" onPress={load} style={{ marginTop: 12 }} />
        ) : null}
      </View>
    );
  }

  const loan = data.loan;
  const next = loan?.next;
  const late = next?.state === 'OVERDUE';
  const dueLine = next
    ? `Instalment ${next.number} of ${loan!.instalmentCount} · ${late ? 'was due' : 'due'} ${formatDate(next.dueDate)}`
    : 'Nothing due';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={{ color: c.forest, fontFamily: font.semibold }}>{data.initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Muted>Muraho,</Muted>
          <Text style={{ fontFamily: font.display, fontSize: 22, color: c.ink }}>
            {data.firstName}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            data.unread ? `Notifications, ${data.unread} unread` : 'Notifications'
          }
          onPress={() => go('notifications')}
          style={styles.bell}
        >
          <Text style={{ fontSize: 18 }}>🔔</Text>
          {data.unread ? <View style={styles.dot} /> : null}
        </Pressable>
      </View>

      {loan ? (
        <Card dark>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text style={{ color: c['forest-muted'], fontSize: 13 }}>
              {next ? (late ? 'Payment overdue' : 'Next payment') : 'All paid'}
            </Text>
            <Pill label={late ? 'Overdue' : 'On track'} tone={late ? 'danger' : 'lime'} />
          </View>
          <Money
            amount={next?.amount ?? '0'}
            style={{ color: c.surface, fontFamily: font.display, fontSize: 34 }}
          />
          <Text style={{ color: c['forest-muted'], fontSize: 13 }}>{dueLine}</Text>
          <View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${loan.repaidPercent}%` }]} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
              <Text style={{ color: c.lime, fontSize: 12, fontFamily: font.semibold }}>
                {loan.repaidPercent}% repaid
              </Text>
              <Text style={{ color: c['forest-muted'], fontSize: 12 }}>
                {formatRwf(BigInt(loan.totalLeft))} left
              </Text>
            </View>
          </View>
          <Button
            label={
              loan.pendingPayment
                ? 'Waiting for MoMo approval…'
                : next
                  ? `Pay ${formatRwf(BigInt(next.amount))} with MoMo`
                  : 'Fully paid'
            }
            variant="accent"
            disabled={!next || !!loan.pendingPayment || !data.wallet}
            onPress={() => setSheet(true)}
          />
          {!data.wallet ? (
            <Text style={{ color: c['forest-muted'], fontSize: 12 }}>
              No MoMo wallet linked. Pay at a branch, or ask your officer to link one.
            </Text>
          ) : null}
        </Card>
      ) : data.pendingLoan ? (
        <Card dark>
          <Text style={{ color: c.surface, fontFamily: font.display, fontSize: 20 }}>
            Your loan is on its way
          </Text>
          <Text style={{ color: c['forest-muted'], fontSize: 13 }}>
            {data.pendingLoan.code} is being sent to your MoMo wallet. We will text you when it
            arrives.
          </Text>
        </Card>
      ) : data.application ? (
        <Card dark>
          <Text style={{ color: c.surface, fontFamily: font.display, fontSize: 20 }}>
            Application in review
          </Text>
          <Text style={{ color: c['forest-muted'], fontSize: 13 }}>
            {data.application.code} · {formatRwf(BigInt(data.application.amount))} ·{' '}
            {data.application.productName}. We will text you with the decision.
          </Text>
        </Card>
      ) : (
        <Card dark>
          <Text style={{ color: c.surface, fontFamily: font.display, fontSize: 20 }}>
            No active loan
          </Text>
          <Text style={{ color: c['forest-muted'], fontSize: 13 }}>
            Apply in 5 minutes, right here.
          </Text>
          <Button label="New loan" variant="accent" onPress={() => go('apply')} />
        </Card>
      )}

      <View style={styles.actions} accessibilityLabel="Quick actions">
        {(
          [
            ['New loan', 'apply', '➕'],
            ['Schedule', 'schedule', '📅'],
            ['Profile', 'profile', '👤'],
          ] as const
        ).map(([label, screen, icon]) => (
          <Pressable
            key={screen}
            accessibilityRole="button"
            onPress={() => go(screen)}
            style={styles.action}
            disabled={screen === 'schedule' && !loan}
          >
            <View style={styles.actionIcon}>
              <Text>{icon}</Text>
            </View>
            <Text
              style={{
                fontSize: 12,
                color: screen === 'schedule' && !loan ? c['ink-muted'] : c.ink,
                fontFamily: font.medium,
              }}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {data.offer ? (
        <Pressable accessibilityRole="button" onPress={() => go('apply')} style={styles.offer}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: c['success-fg'], fontSize: 12, fontFamily: font.semibold }}>
              Pre-approved for you
            </Text>
            <Text style={{ fontFamily: font.display, fontSize: 20, color: c.ink }}>
              Up to {formatRwf(BigInt(data.offer.maxAmount))}
            </Text>
            <Muted>Top up your {data.offer.productName.toLowerCase()} in 5 minutes</Muted>
          </View>
          <Text style={{ fontSize: 20, color: c.forest }}>›</Text>
        </Pressable>
      ) : null}

      {loan ? (
        <Card>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text style={{ fontFamily: font.display, fontSize: 17, color: c.ink }}>
              Recent activity
            </Text>
            <Pressable accessibilityRole="button" onPress={() => go('schedule')} hitSlop={10}>
              <Text style={{ color: c.forest, fontFamily: font.semibold, fontSize: 13 }}>
                See all
              </Text>
            </Pressable>
          </View>
          {loan.activity.length === 0 ? <Muted>No payments yet.</Muted> : null}
          {loan.activity.map((a) => (
            <View key={a.id} style={styles.activity}>
              <View style={styles.activityIcon}>
                <Text style={{ color: c.forest, fontSize: 12 }}>✓</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, color: c.ink, fontFamily: font.medium }}>
                  {a.title}
                </Text>
                <Muted>{a.when}</Muted>
              </View>
              <Text
                style={{ fontFamily: font.semibold, color: c.ink, fontVariant: ['tabular-nums'] }}
              >
                −{formatRwf(BigInt(a.amount)).replace('RWF ', '')}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Modal
        visible={sheet}
        transparent
        animationType="slide"
        onRequestClose={() => setSheet(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setSheet(false)}
          accessibilityLabel="Close"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.handle} />
          <Text
            accessibilityRole="header"
            style={{ fontFamily: font.display, fontSize: 22, color: c.ink }}
          >
            Confirm payment
          </Text>
          {next && loan ? (
            <View style={{ gap: 10 }}>
              <Row label="Amount" value={formatRwf(BigInt(next.amount))} />
              <Row label="From" value={data.wallet ?? '—'} />
              <Row label="For" value={`Instalment ${next.number} of ${loan.instalmentCount}`} />
              <Row label="Fee" value="RWF 0" />
            </View>
          ) : null}
          <Muted>You’ll get a MoMo prompt on your phone. Enter your PIN there to approve.</Muted>
          <Button
            label={next ? `Pay ${formatRwf(BigInt(next.amount))}` : 'Pay'}
            variant="accent"
            loading={paying}
            onPress={confirmPay}
          />
          <Button label="Cancel" variant="ghost" onPress={() => setSheet(false)} />
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c['avatar-bg'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  bell: {
    width: 44,
    height: 44,
    borderRadius: r.control,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: 9,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.rust,
    borderWidth: 2,
    borderColor: c.surface,
  },
  track: { height: 6, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.15)' },
  fill: { height: 6, borderRadius: 99, backgroundColor: c.lime },
  actions: { flexDirection: 'row', gap: 10 },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    backgroundColor: c.surface,
    borderRadius: r.panel,
    borderWidth: 1,
    borderColor: c.line,
    minHeight: 80,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: c.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: c['lime-tint'],
    borderWidth: 1,
    borderColor: c['lime-deep'],
    borderRadius: r.card,
    padding: 18,
  },
  activity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: c['line-soft'],
  },
  activityIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c['success-bg'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(18,22,20,0.45)' },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 32,
    gap: 14,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.line, alignSelf: 'center' },
});
