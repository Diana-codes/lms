import { formatDate, formatRwf, formatRwfCompact } from '@kora/core';
import { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api, clearTokens, errorMessage, openPdf } from '../lib/api';
import type { Home, Insights, Profile, Schedule, Statement } from '../lib/types';
import { Button, DarkCard, Muted, Panel, Row, RoundButton, Sheet, Toggle } from '../ui';
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronRightIcon,
  DocumentIcon,
  PhoneIcon,
  SignOutIcon,
} from '../ui/icons';
import { c, font } from '../ui/theme';

const STATE = {
  PAID: ['Paid', c['success-bg'], c['success-fg']],
  PARTIAL: ['Part paid', c['warning-bg'], c['warning-fg']],
  OVERDUE: ['Overdue', c['danger-bg'], c['danger-fg']],
  DUE_NEXT: ['Due next', c.ink, c.lime],
  UPCOMING: ['Upcoming', c['neutral-bg'], c['neutral-fg']],
} as const;

function StatusPill({ state }: { state: keyof typeof STATE }) {
  const [label, bg, fg] = STATE[state];
  return (
    <View
      style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}
    >
      <Text style={{ color: fg, fontSize: 12, fontFamily: font.semibold }}>{label}</Text>
    </View>
  );
}

function TabTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={{ gap: 2 }}>
      {sub ? <Muted style={{ fontSize: 13 }}>{sub}</Muted> : null}
      <Text
        accessibilityRole="header"
        style={{ fontFamily: font.display, fontSize: 26, letterSpacing: -0.5, color: c.ink }}
      >
        {title}
      </Text>
    </View>
  );
}

/** Screens pushed over the tabs (Statement, Notifications) get a back arrow. */
export function BackBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 20,
        paddingTop: 12,
      }}
    >
      <RoundButton label="Back" onPress={onBack}>
        <ArrowLeftIcon size={18} color={c.ink} />
      </RoundButton>
      <Text
        accessibilityRole="header"
        style={{ fontFamily: font.display, fontSize: 20, color: c.ink }}
      >
        {title}
      </Text>
    </View>
  );
}

function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  const refresh = (
    <RefreshControl
      refreshing={refreshing}
      tintColor={c.forest}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    />
  );
  return { data, error, refresh, reload: load };
}

// ── Loans tab: the repayment schedule ────────────────────────────────────

export function LoansTab({ loanCode, onApply }: { loanCode: string | null; onApply: () => void }) {
  const { data, error, refresh } = useLoad<Schedule>(
    loanCode ? `/app/loans/${loanCode}/schedule` : null,
  );
  const [all, setAll] = useState(false);
  if (!loanCode) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <TabTitle title="Loans" />
        <Panel>
          <Text style={{ fontSize: 15, color: c.ink, fontFamily: font.medium }}>
            You have no active loan.
          </Text>
          <Muted style={{ fontSize: 13 }}>Apply in 5 minutes. No fees to apply.</Muted>
          <Button label="Apply for a loan" onPress={onApply} />
        </Panel>
      </ScrollView>
    );
  }
  const rows = data ? (all ? data.rows : data.rows.slice(0, 8)) : [];
  const paid = data?.rows.filter((r) => r.state === 'PAID').length ?? 0;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={refresh}
    >
      <TabTitle title="Repayment schedule" sub={loanCode} />
      {error ? <Muted style={{ fontSize: 14 }}>{error}</Muted> : null}
      {data ? (
        <>
          <DarkCard>
            <Row dark label="Loan amount" value={formatRwf(BigInt(data.principal))} />
            <Row
              dark
              label="Interest"
              value={`${(data.annualRateBps / 100).toFixed(0)}% a year · reducing balance`}
            />
            <Row dark label="Instalments" value={`${paid} of ${data.rows.length} paid`} />
          </DarkCard>
          <Panel style={{ gap: 0, paddingVertical: 6 }}>
            {rows.map((row, i) => (
              <View key={row.number} style={[styles.scheduleRow, i === 0 && { borderTopWidth: 0 }]}>
                <Text
                  style={{
                    width: 22,
                    color: c['ink-muted'],
                    fontVariant: ['tabular-nums'],
                    fontFamily: font.body,
                  }}
                >
                  {row.number}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.ink, fontFamily: font.medium, fontSize: 14 }}>
                    {formatDate(row.dueDate)}
                  </Text>
                  {row.state === 'PARTIAL' ||
                  (row.state === 'OVERDUE' && row.remaining !== row.amount) ? (
                    <Muted>{formatRwf(BigInt(row.remaining))} left</Muted>
                  ) : null}
                  {row.penalty !== '0' ? (
                    <Text style={{ fontSize: 12, color: c['caution-fg'], fontFamily: font.body }}>
                      incl. {formatRwf(BigInt(row.penalty))} late penalty
                    </Text>
                  ) : null}
                </View>
                <Text
                  style={{
                    fontFamily: font.semibold,
                    color: c.ink,
                    marginRight: 10,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {formatRwf(BigInt(row.amount), { symbol: false })}
                </Text>
                <StatusPill state={row.state} />
              </View>
            ))}
          </Panel>
          {data.rows.length > 8 ? (
            <Button
              label={all ? 'Show fewer' : `Show all ${data.rows.length} instalments`}
              variant="outline"
              height={44}
              onPress={() => setAll((v) => !v)}
            />
          ) : null}
          <Muted>Amounts are in Rwandan francs (RWF).</Muted>
        </>
      ) : null}
    </ScrollView>
  );
}

// ── Insights tab: the borrower's own record ──────────────────────────────

export function InsightsTab() {
  const { data, error, refresh } = useLoad<Insights>('/app/insights');
  const max = data
    ? data.months.reduce((m, x) => (BigInt(x.amount) > m ? BigInt(x.amount) : m), 1n)
    : 1n;
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={refresh}
    >
      <TabTitle title="Insights" sub="Your repayment record" />
      {error ? <Muted style={{ fontSize: 14 }}>{error}</Muted> : null}
      {data ? (
        <>
          <DarkCard radius={26} style={{ padding: 22 }}>
            <Text style={{ fontSize: 13, color: c['forest-muted'], fontFamily: font.body }}>
              Paid on time
            </Text>
            <Text style={{ fontFamily: font.display, fontSize: 40, color: c.lime }}>
              {data.onTimeRatePct == null ? '—' : `${data.onTimeRatePct}%`}
            </Text>
            <Text
              style={{
                fontSize: 13,
                color: c['forest-muted'],
                fontFamily: font.body,
                lineHeight: 19,
              }}
            >
              {data.instalmentsPaid === 0
                ? 'Your record starts with your first payment.'
                : `${data.paidOnTime} of ${data.instalmentsPaid} instalments on time${data.paidEarly ? `, ${data.paidEarly} early` : ''}. ${data.overdueNow ? `${data.overdueNow} overdue now.` : 'Nothing overdue.'}`}
            </Text>
          </DarkCard>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(
              [
                ['Paid this year', formatRwfCompact(BigInt(data.paidThisYear))],
                ['Loans repaid', String(data.loansRepaid)],
                [
                  'Pre-approved',
                  data.preApprovedLimit ? formatRwfCompact(BigInt(data.preApprovedLimit)) : '—',
                ],
              ] as const
            ).map(([label, value]) => (
              <Panel key={label} radius={18} style={{ flex: 1, gap: 6, padding: 14 }}>
                <Muted>{label}</Muted>
                <Text style={{ fontFamily: font.display, fontSize: 18, color: c.ink }}>
                  {value}
                </Text>
              </Panel>
            ))}
          </View>
          <Panel>
            <Text style={{ fontFamily: font.display, fontSize: 17, color: c.ink }}>
              Payments by month
            </Text>
            <View
              accessible
              accessibilityLabel={`Payments by month: ${data.months.map((m) => `${MONTHS[Number(m.month.slice(5, 7)) - 1]} ${formatRwf(BigInt(m.amount))}`).join(', ')}`}
              style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 10 }}
            >
              {data.months.map((m) => (
                <View
                  key={m.month}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    gap: 6,
                    height: '100%',
                    justifyContent: 'flex-end',
                  }}
                >
                  <View
                    style={{
                      width: '70%',
                      maxWidth: 28,
                      borderRadius: 6,
                      backgroundColor: BigInt(m.amount) > 0n ? c.forest : c.track,
                      height: `${Math.max(4, Number((BigInt(m.amount) * 100n) / max))}%`,
                    }}
                  />
                  <Text style={{ fontSize: 11, color: c['ink-muted'], fontFamily: font.body }}>
                    {MONTHS[Number(m.month.slice(5, 7)) - 1]}
                  </Text>
                </View>
              ))}
            </View>
          </Panel>
          <Panel style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: c['success-bg'],
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CheckIcon size={16} color={c['success-fg']} />
            </View>
            <Text
              style={{
                flex: 1,
                fontSize: 13,
                lineHeight: 19,
                color: c['ink-soft'],
                fontFamily: font.body,
              }}
            >
              Paying on time, every time, raises the amount you can borrow next. Paying early never
              costs extra.
            </Text>
          </Panel>
        </>
      ) : null}
    </ScrollView>
  );
}

// ── Profile tab ──────────────────────────────────────────────────────────

export function ProfileTab({
  onSignedOut,
  onDocuments,
  toast,
}: {
  onSignedOut: () => void;
  onDocuments: () => void;
  toast: (m: string) => void;
}) {
  const { data, error, refresh, reload } = useLoad<Profile>('/app/profile');
  const sharing = data?.consents.some((x) => x.type === 'MOMO_HISTORY') ?? false;

  async function signOut() {
    try {
      await api('/app/auth/logout', { method: 'POST' });
    } catch {
      // already signed out
    }
    await clearTokens();
    onSignedOut();
  }

  const [opening, setOpening] = useState<string | null>(null);
  async function openAgreement(loanCode: string) {
    setOpening(loanCode);
    try {
      await openPdf(`/app/loans/${loanCode}/agreement.pdf`, `${loanCode}-agreement.pdf`);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setOpening(null);
    }
  }

  async function stopSharing() {
    try {
      await api('/app/profile/consents/withdraw', {
        method: 'POST',
        body: { type: 'MOMO_HISTORY' },
      });
      toast('MoMo history is no longer shared.');
      await reload();
    } catch (err) {
      toast(errorMessage(err));
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={refresh}
    >
      <TabTitle title="Profile" />
      {error ? <Muted style={{ fontSize: 14 }}>{error}</Muted> : null}
      {data ? (
        <>
          <Panel>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  backgroundColor: c.forest,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: c.lime, fontFamily: font.display, fontSize: 18 }}>
                  {data.name
                    .split(' ')
                    .slice(0, 2)
                    .map((w) => w[0])
                    .join('')}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: font.display, fontSize: 18, color: c.ink }}>
                  {data.name}
                </Text>
                <Muted>Customer {data.code}</Muted>
              </View>
            </View>
            <Row label="Phone" value={data.phone} />
            {data.nationalId ? <Row label="National ID" value={data.nationalId} /> : null}
            <Row
              label="Identity"
              value={
                <View
                  style={{
                    backgroundColor:
                      data.kycStatus === 'VERIFIED' ? c['success-bg'] : c['warning-bg'],
                    borderRadius: 999,
                    paddingHorizontal: 9,
                    paddingVertical: 3,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: font.semibold,
                      color: data.kycStatus === 'VERIFIED' ? c['success-fg'] : c['warning-fg'],
                    }}
                  >
                    {data.kycStatus === 'VERIFIED' ? 'Verified with NIDA' : 'Being checked'}
                  </Text>
                </View>
              }
            />
            {data.business ? <Row label="Business" value={data.business.name} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Your documents"
              onPress={onDocuments}
              style={({ pressed }) => [styles.docsRow, pressed && { opacity: 0.7 }]}
            >
              <DocumentIcon size={18} color={c.forest} />
              <Text style={{ flex: 1, fontSize: 15, fontFamily: font.semibold, color: c.ink }}>
                Your documents
              </Text>
              <Muted>ID, selfie, RDB, statements</Muted>
              <ChevronRightIcon size={18} color={c['ink-muted']} />
            </Pressable>
          </Panel>
          <Panel>
            <Text style={{ fontSize: 13, fontFamily: font.semibold, color: c.ink }}>
              Your loans
            </Text>
            {data.loans.length === 0 ? <Muted style={{ fontSize: 13 }}>None yet.</Muted> : null}
            {data.loans.map((l) => (
              <View key={l.code} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: font.medium, color: c.ink }}>
                    {l.productName}
                  </Text>
                  <Muted>{l.code}</Muted>
                  {l.hasAgreement ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open the loan agreement for ${l.code}`}
                      onPress={() => openAgreement(l.code)}
                      hitSlop={10}
                      style={{ minHeight: 28, justifyContent: 'center' }}
                    >
                      <Text style={{ fontSize: 13, fontFamily: font.semibold, color: c.forest }}>
                        {opening === l.code ? 'Opening…' : 'Agreement (PDF)'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text
                  style={{
                    fontSize: 14,
                    fontFamily: font.semibold,
                    color: c.ink,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {formatRwfCompact(BigInt(l.principal))}
                </Text>
                <View
                  style={{
                    backgroundColor: l.status === 'ACTIVE' ? c.ink : c['success-bg'],
                    borderRadius: 999,
                    paddingHorizontal: 9,
                    paddingVertical: 3,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: font.semibold,
                      color: l.status === 'ACTIVE' ? c.lime : c['success-fg'],
                    }}
                  >
                    {l.status === 'ACTIVE'
                      ? 'Active'
                      : l.status === 'REPAID'
                        ? 'Repaid'
                        : l.status === 'PENDING_DISBURSEMENT'
                          ? 'Sending'
                          : 'Closed'}
                  </Text>
                </View>
              </View>
            ))}
          </Panel>
          <Panel>
            <Text style={{ fontSize: 13, fontFamily: font.semibold, color: c.ink }}>Your data</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontFamily: font.medium, color: c.ink }}>
                  Share MoMo history
                </Text>
                <Muted>Used only to assess your loans. You can stop at any time.</Muted>
              </View>
              <Toggle
                label="Share MoMo history"
                value={sharing}
                onChange={(v) =>
                  v ? toast('Turn sharing on again when you next apply.') : void stopSharing()
                }
              />
            </View>
            <Muted>
              Kora Lend keeps your data in Rwanda and only uses it to manage your loans.
            </Muted>
          </Panel>
          <Pressable
            accessibilityRole="button"
            onPress={signOut}
            style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.7 }]}
          >
            <SignOutIcon size={18} color={c.rust} />
            <Text style={{ color: c.rust, fontFamily: font.semibold, fontSize: 15 }}>Sign out</Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

// ── Statement (from Home) ────────────────────────────────────────────────

export function StatementScreen({ loanCode, onBack }: { loanCode: string; onBack: () => void }) {
  const { data, error, refresh } = useLoad<Statement>(`/app/loans/${loanCode}/statement`);
  return (
    <View style={styles.screen}>
      <BackBar title="Statement" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={refresh}>
        {error ? <Muted style={{ fontSize: 14 }}>{error}</Muted> : null}
        {data ? (
          <>
            <DarkCard>
              <Text style={{ fontSize: 12, color: c['forest-muted'], fontFamily: font.body }}>
                {data.productName} · {data.code}
              </Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 12, color: c['forest-muted'], fontFamily: font.body }}>
                    Paid so far
                  </Text>
                  <Text style={{ fontFamily: font.display, fontSize: 22, color: c.lime }}>
                    {formatRwf(BigInt(data.totalPaid))}
                  </Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 12, color: c['forest-muted'], fontFamily: font.body }}>
                    Left to pay
                  </Text>
                  <Text style={{ fontFamily: font.display, fontSize: 22, color: c.surface }}>
                    {formatRwf(BigInt(data.leftToPay))}
                  </Text>
                </View>
              </View>
              <Text style={{ fontSize: 12, color: c['forest-muted'], fontFamily: font.body }}>
                Borrowed {formatRwf(BigInt(data.principal))}
                {data.disbursedOn ? ` on ${formatDate(data.disbursedOn)}` : ''}
              </Text>
            </DarkCard>
            <Panel style={{ gap: 0, paddingVertical: 6 }}>
              {data.payments.length === 0 ? (
                <Muted style={{ fontSize: 14, paddingVertical: 10 }}>No payments yet.</Muted>
              ) : null}
              {data.payments.map((p, i) => (
                <View key={p.id} style={[styles.scheduleRow, i === 0 && { borderTopWidth: 0 }]}>
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      backgroundColor: c['success-bg'],
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CheckIcon size={16} color={c['success-fg']} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontFamily: font.medium, color: c.ink }}>
                      {p.note}
                    </Text>
                    <Muted>
                      {formatDate(p.receivedOn)} · {p.channel}
                    </Muted>
                  </View>
                  <Text
                    style={{
                      fontFamily: font.semibold,
                      color: c.ink,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {formatRwf(BigInt(p.amount), { symbol: false })}
                  </Text>
                </View>
              ))}
            </Panel>
            <Muted>
              Amounts are in Rwandan francs (RWF). For a stamped statement, ask your branch.
            </Muted>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ── Notifications (from the bell) ────────────────────────────────────────

export function NotificationsScreen({ onBack }: { onBack: () => void }) {
  const { data, refresh } =
    useLoad<Array<{ id: string; title: string; at: string; read: boolean }>>('/app/notifications');
  return (
    <View style={styles.screen}>
      <BackBar title="Notifications" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={refresh}>
        {data?.length === 0 ? <Muted style={{ fontSize: 14 }}>Nothing yet.</Muted> : null}
        {data?.map((n) => (
          <Panel
            key={n.id}
            radius={16}
            style={{ gap: 4, padding: 14, borderColor: n.read ? c.line : c['lime-deep'] }}
          >
            <Text style={{ fontSize: 14, color: c.ink, fontFamily: font.medium }}>{n.title}</Text>
            <Muted>{formatDate(n.at.slice(0, 10))}</Muted>
          </Panel>
        ))}
      </ScrollView>
    </View>
  );
}

// ── Support (sheet from Home) ────────────────────────────────────────────

/** Set EXPO_PUBLIC_SUPPORT_PHONE in apps/mobile/.env to show a call button. */
const SUPPORT_PHONE = process.env.EXPO_PUBLIC_SUPPORT_PHONE;

export function SupportSheet({
  open,
  onClose,
  home,
}: {
  open: boolean;
  onClose: () => void;
  home: Home | null;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Support">
      <Muted style={{ fontSize: 14, lineHeight: 20 }}>
        {home?.support.officerName
          ? `Your loan officer is ${home.support.officerName}${home.support.branch ? `, at ${home.support.branch}` : ''}. They can help with payments, a new loan or changing your plan.`
          : 'Visit your nearest Kora Lend branch and we will help with payments, a new loan or changing your plan.'}
      </Muted>
      {SUPPORT_PHONE ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`)}
          style={({ pressed }) => [styles.callButton, pressed && { opacity: 0.85 }]}
        >
          <PhoneIcon size={18} color={c.surface} />
          <Text style={{ color: c.surface, fontFamily: font.semibold, fontSize: 16 }}>
            Call {SUPPORT_PHONE}
          </Text>
        </Pressable>
      ) : null}
      <Muted>
        Never share your MoMo PIN or sign-in code with anyone, including Kora Lend staff.
      </Muted>
      <Button label="Close" variant="ghost" height={44} onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28, gap: 16 },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: c['line-soft'],
  },
  docsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: c['line-soft'],
  },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.surface,
  },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 54,
    borderRadius: 16,
    backgroundColor: c.ink,
  },
});
