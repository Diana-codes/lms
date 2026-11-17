import { formatDate, formatRwf, isMtnRwPhone, maskPhone, normaliseRwPhone } from '@kora/core';
import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, errorMessage } from '../lib/api';
import type { Home as HomeData } from '../lib/types';
import { Button, Choice, GreyBox, Label, Muted, Row, Sheet, tap } from '../ui';
import {
  AlertIcon,
  ArrowRightIcon,
  BellIcon,
  CalendarIcon,
  ChatIcon,
  CheckIcon,
  ChevronRightIcon,
  DocumentIcon,
  PlusIcon,
} from '../ui/icons';
import { c, font } from '../ui/theme';

export type HomeGo = 'apply' | 'schedule' | 'statement' | 'support' | 'notifications' | 'documents';

export function Home({
  go,
  toast,
  onLoaded,
}: {
  go: (to: HomeGo) => void;
  toast: (m: string) => void;
  onLoaded: (h: HomeData) => void;
}) {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      const h = await api<HomeData>('/app/home');
      setData(h);
      onLoaded(h);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [onLoaded]);

  useEffect(() => {
    void load();
  }, [load]);

  // Pay from the borrower's own wallet, or another MTN number (spouse, business).
  const [useOther, setUseOther] = useState(false);
  const [otherPhone, setOtherPhone] = useState('');
  const otherE164 = normaliseRwPhone(otherPhone);
  const otherError = !otherPhone.trim()
    ? null
    : !otherE164
      ? 'Enter a Rwandan mobile number, like 078 123 4567'
      : !isMtnRwPhone(otherE164)
        ? 'MoMo needs an MTN number starting 078 or 079'
        : null;

  function openPay() {
    tap();
    setUseOther(!data?.wallet);
    setOtherPhone('');
    setSheet(true);
  }

  async function confirmPay() {
    if (!data?.loan) return;
    if (useOther && (!otherE164 || otherError)) return;
    setPaying(true);
    try {
      const r = await api<{ paymentId: string }>(`/app/loans/${data.loan.code}/pay`, {
        method: 'POST',
        body: useOther ? { phone: otherE164 } : {},
      });
      setSheet(false);
      toast(
        useOther
          ? `MoMo prompt sent to ${maskPhone(otherE164!)}. Its owner enters their PIN to approve.`
          : 'Check your phone for the MoMo prompt and enter your PIN to approve.',
      );
      await load();
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
        style={[
          styles.screen,
          { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
        ]}
      >
        <Muted style={{ fontSize: 14 }}>{error ?? 'Loading…'}</Muted>
        {error ? <Button label="Try again" variant="outline" height={44} onPress={load} /> : null}
      </View>
    );
  }

  const loan = data.loan;
  const next = loan?.next;
  const late = next?.state === 'OVERDUE';
  const pending = Boolean(loan?.pendingPayment);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={c.forest}
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
          <Text style={{ color: c.forest, fontFamily: font.semibold, fontSize: 15 }}>
            {data.initials}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, color: c['ink-muted'], fontFamily: font.body }}>
            Muraho,
          </Text>
          <Text style={{ fontFamily: font.display, fontSize: 20, color: c.ink }}>
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
          <BellIcon size={18} color={c.ink} />
          {data.unread ? <View style={styles.dot} /> : null}
        </Pressable>
      </View>

      {loan ? (
        <View style={styles.dueCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text
              style={{ fontSize: 13, color: c['forest-muted'], flex: 1, fontFamily: font.body }}
            >
              {next
                ? late
                  ? 'Payment overdue'
                  : `Next payment · ${formatDate(next.dueDate, { year: false })}`
                : 'All instalments paid'}
            </Text>
            <View style={[styles.pill, late && { backgroundColor: 'rgba(194,65,12,0.25)' }]}>
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: font.semibold,
                  color: late ? '#FFB59A' : c.lime,
                }}
              >
                {late ? 'Overdue' : 'On track'}
              </Text>
            </View>
          </View>
          <View style={{ gap: 2 }}>
            <Text
              style={{
                fontFamily: font.display,
                fontSize: 34,
                letterSpacing: -0.7,
                color: c.surface,
                fontVariant: ['tabular-nums'],
              }}
            >
              {formatRwf(BigInt(next?.amount ?? '0'))}
            </Text>
            <Text style={{ fontSize: 13, color: c['forest-muted'], fontFamily: font.body }}>
              {next
                ? `Instalment ${next.number} of ${loan.instalmentCount} · ${loan.code}`
                : `${loan.code} is fully repaid`}
            </Text>
          </View>
          <View style={{ gap: 8 }}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${loan.repaidPercent}%` }]} />
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Text
                style={{ flex: 1, fontSize: 12, color: c['forest-muted'], fontFamily: font.body }}
              >
                {loan.repaidPercent}% repaid
              </Text>
              <Text style={{ fontSize: 12, color: c['forest-muted'], fontFamily: font.body }}>
                {formatRwf(BigInt(loan.totalLeft))} left
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={!next || pending}
            onPress={openPay}
            style={({ pressed }) => [
              styles.payButton,
              (!next || pending) && { opacity: 0.55 },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={{ color: c.forest, fontFamily: font.semibold, fontSize: 15 }}>
              {pending ? 'Waiting for MoMo approval…' : next ? 'Pay with MoMo' : 'Fully paid'}
            </Text>
          </Pressable>
          {!data.wallet ? (
            <Text style={{ color: c['forest-muted'], fontSize: 12 }}>
              Your own wallet isn’t linked yet. You can pay from another MTN number, or at a branch.
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.dueCard}>
          <Text style={{ fontSize: 13, color: c['forest-muted'], fontFamily: font.body }}>
            {data.pendingLoan
              ? 'Your loan is on its way'
              : data.application
                ? 'Application in review'
                : 'No active loan'}
          </Text>
          <Text style={{ fontFamily: font.display, fontSize: 24, color: c.surface }}>
            {data.pendingLoan
              ? data.pendingLoan.code
              : data.application
                ? formatRwf(BigInt(data.application.amount))
                : 'Borrow for your business'}
          </Text>
          <Text
            style={{
              fontSize: 13,
              color: c['forest-muted'],
              lineHeight: 19,
              fontFamily: font.body,
            }}
          >
            {data.pendingLoan
              ? 'It is being sent to your MoMo wallet. We will text you when it arrives.'
              : data.application
                ? `${data.application.code} · ${data.application.productName}. We will text you as soon as there is a decision.`
                : 'Apply in 5 minutes, right here. No fees to apply.'}
          </Text>
          {!data.pendingLoan && !data.application ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => go('apply')}
              style={styles.payButton}
            >
              <Text style={{ color: c.forest, fontFamily: font.semibold, fontSize: 15 }}>
                Apply for a loan
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {data.documentsNeeded > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${data.documentsNeeded} ${data.documentsNeeded === 1 ? 'document' : 'documents'} needed. Open documents.`}
          onPress={() => {
            tap();
            go('documents');
          }}
          style={({ pressed }) => [styles.docBanner, pressed && { opacity: 0.8 }]}
        >
          <View style={styles.docIcon}>
            <AlertIcon size={20} color={c['warning-fg']} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 15, fontFamily: font.semibold, color: c['caution-ink'] }}>
              {data.documentsNeeded === 1
                ? '1 document needed'
                : `${data.documentsNeeded} documents needed`}
            </Text>
            <Text style={{ fontSize: 13, color: c['warning-fg'], fontFamily: font.body }}>
              Send them here to keep your application moving.
            </Text>
          </View>
          <ChevronRightIcon size={18} color={c['warning-fg']} />
        </Pressable>
      ) : null}

      <View accessibilityLabel="Quick actions" style={styles.actions}>
        {(
          [
            ['New loan', 'apply', PlusIcon],
            ['Schedule', 'schedule', CalendarIcon],
            ['Statement', 'statement', DocumentIcon],
            ['Support', 'support', ChatIcon],
          ] as const
        ).map(([label, to, Icon]) => {
          const off = (to === 'schedule' || to === 'statement') && !loan;
          return (
            <Pressable
              key={to}
              accessibilityRole="button"
              accessibilityState={{ disabled: off }}
              disabled={off}
              onPress={() => {
                tap();
                go(to);
              }}
              style={({ pressed }) => [styles.action, { opacity: off ? 0.4 : pressed ? 0.7 : 1 }]}
            >
              <View style={styles.actionTile}>
                <Icon size={22} color={c.forest} />
              </View>
              <Text style={{ fontSize: 12, color: c['ink-soft'], fontFamily: font.body }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {data.offer ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => go('apply')}
          style={({ pressed }) => [styles.offer, pressed && { opacity: 0.9 }]}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 12, fontFamily: font.semibold, color: c['success-fg'] }}>
              Pre-approved for you
            </Text>
            <Text style={{ fontFamily: font.display, fontSize: 20, color: c.forest }}>
              Up to {formatRwf(BigInt(data.offer.maxAmount))}
            </Text>
            <Text style={{ fontSize: 12, color: c['success-fg'], fontFamily: font.body }}>
              Top up your {data.offer.productName.toLowerCase()} in 5 minutes
            </Text>
          </View>
          <View style={styles.offerArrow}>
            <ArrowRightIcon size={18} color={c.lime} />
          </View>
        </Pressable>
      ) : null}

      {loan ? (
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text
              accessibilityRole="header"
              style={{ flex: 1, fontFamily: font.display, fontSize: 17, color: c.ink }}
            >
              Recent activity
            </Text>
            <Pressable accessibilityRole="button" onPress={() => go('statement')} hitSlop={10}>
              <Text style={{ color: c.forest, fontFamily: font.semibold, fontSize: 13 }}>
                See all
              </Text>
            </Pressable>
          </View>
          {loan.activity.length === 0 ? (
            <Muted style={{ fontSize: 14 }}>No payments yet.</Muted>
          ) : null}
          {loan.activity.map((a) => (
            <View key={a.id} style={styles.activity}>
              <View style={styles.activityIcon}>
                <CheckIcon size={18} color={c['success-fg']} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, color: c.ink, fontFamily: font.medium }}>
                  {a.title}
                </Text>
                <Text style={{ fontSize: 12, color: c['ink-muted'], fontFamily: font.body }}>
                  {a.when}
                </Text>
              </View>
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: font.semibold,
                  color: c.ink,
                  fontVariant: ['tabular-nums'],
                }}
              >
                −{formatRwf(BigInt(a.amount), { symbol: false })}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Confirm payment">
        {next && loan ? (
          <GreyBox>
            <Row
              label="Amount"
              value={formatRwf(BigInt(next.amount))}
              valueStyle={{ fontFamily: font.semibold }}
            />
            <Row
              label="From"
              value={
                useOther
                  ? otherE164 && !otherError
                    ? `MTN MoMo · ${maskPhone(otherE164).replace('+250 ', '0')}`
                    : 'Another number'
                  : (data.wallet ?? '—')
              }
              valueStyle={{ fontFamily: font.semibold }}
            />
            <Row
              label="For"
              value={`Instalment ${next.number} of ${loan.instalmentCount}`}
              valueStyle={{ fontFamily: font.semibold }}
            />
            <Row label="Fee" value="RWF 0" valueStyle={{ fontFamily: font.semibold }} />
          </GreyBox>
        ) : null}
        <View style={{ gap: 10 }}>
          <Label>Pay from</Label>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
            {data.wallet ? (
              <Choice
                pill
                label="My number"
                selected={!useOther}
                onPress={() => setUseOther(false)}
              />
            ) : null}
            <Choice
              pill
              label="Another MTN number"
              selected={useOther}
              onPress={() => setUseOther(true)}
            />
          </View>
          {useOther ? (
            <View style={{ gap: 6 }}>
              <TextInput
                accessibilityLabel="MTN number to pay from"
                value={otherPhone}
                onChangeText={setOtherPhone}
                placeholder="078 123 4567"
                placeholderTextColor={c['ink-muted']}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                autoComplete="tel"
                maxLength={16}
                style={[styles.phoneInput, otherError ? { borderColor: c.rust } : null]}
              />
              {otherError ? (
                <Text accessibilityRole="alert" style={{ color: c['danger-fg'], fontSize: 13 }}>
                  {otherError}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
        <Muted style={{ fontSize: 13, lineHeight: 19 }}>
          {useOther
            ? 'The owner of this number gets the MoMo prompt and enters their PIN to approve. Only pay from a wallet whose owner agrees.'
            : 'You’ll get a MoMo prompt on your phone. Enter your PIN there to approve.'}
        </Muted>
        <Button
          label={next ? `Pay ${formatRwf(BigInt(next.amount))}` : 'Pay'}
          variant="lime"
          loading={paying}
          disabled={useOther && (!otherE164 || otherError != null)}
          onPress={confirmPay}
        />
        <Button label="Cancel" variant="ghost" height={44} onPress={() => setSheet(false)} />
      </Sheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, gap: 18 },
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
    borderRadius: 22,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: 10,
    right: 11,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.rust,
    borderWidth: 2,
    borderColor: c.surface,
  },
  dueCard: { backgroundColor: c.forest, borderRadius: 26, padding: 22, gap: 16 },
  pill: {
    backgroundColor: c.limeSoft,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  track: { height: 8, borderRadius: 99, backgroundColor: c.whiteSoft },
  fill: { height: 8, borderRadius: 99, backgroundColor: c.lime },
  payButton: {
    height: 50,
    borderRadius: 14,
    backgroundColor: c.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneInput: {
    height: 52,
    borderWidth: 1,
    borderColor: c.field,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 17,
    fontFamily: font.medium,
    color: c.ink,
    backgroundColor: c.surface,
    fontVariant: ['tabular-nums'],
  },
  docBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: c['caution-bg'],
    borderWidth: 1,
    borderColor: '#F6D7A8',
    borderRadius: 20,
    padding: 14,
    minHeight: 64,
  },
  docIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: c['warning-bg'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, alignItems: 'center', gap: 8 },
  actionTile: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offer: {
    backgroundColor: c.lime,
    borderRadius: 22,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  offerArrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.forest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activity: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  activityIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: c['success-bg'],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
