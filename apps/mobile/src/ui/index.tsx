import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { formatRwf, formatRwfCompact, parseRwf } from '@kora/core';
import { c, font, r, TOUCH } from './theme';

export function Money({
  amount,
  compact,
  style,
}: {
  amount: bigint | string;
  compact?: boolean;
  style?: TextStyle;
}) {
  const value = typeof amount === 'string' ? parseRwf(amount) : amount;
  return (
    <Text style={[{ fontVariant: ['tabular-nums'] }, style]}>
      {(compact ? formatRwfCompact : formatRwf)(value)}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'accent' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const off = disabled || loading;
  const bg = { primary: c.ink, accent: c.lime, secondary: c.surface, ghost: 'transparent' }[
    variant
  ];
  const fg = { primary: c.surface, accent: c.forest, secondary: c.ink, ghost: c.forest }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: loading }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: off && variant !== 'secondary' ? '#DADDD5' : bg,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: c.line,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            { color: off && variant !== 'secondary' ? c['ink-muted'] : fg },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Card({
  children,
  dark,
  style,
}: {
  children: ReactNode;
  dark?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        styles.card,
        dark
          ? { backgroundColor: c.forest }
          : { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'success' | 'warning' | 'danger' | 'neutral' | 'lime';
}) {
  const [bg, fg] = {
    success: [c['success-bg'], c['success-fg']],
    warning: [c['warning-bg'], c['warning-fg']],
    danger: [c['danger-bg'], c['danger-fg']],
    neutral: [c['neutral-bg'], c['neutral-fg']],
    lime: [c.lime, c.forest],
  }[tone];
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: r.pill,
        paddingHorizontal: 10,
        paddingVertical: 4,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: fg, fontSize: 12, fontFamily: font.semibold }}>{label}</Text>
    </View>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {typeof value === 'string' ? <Text style={styles.rowValue}>{value}</Text> : value}
    </View>
  );
}

export function Choice({
  label,
  selected,
  onPress,
  style,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.choice,
        selected
          ? { borderWidth: 2, borderColor: c.forest, backgroundColor: c['success-bg'] }
          : { borderWidth: 1, borderColor: c.line, backgroundColor: c.surface },
        style,
      ]}
    >
      <Text
        style={{
          fontSize: 14,
          fontFamily: selected ? font.semibold : font.body,
          color: selected ? c.forest : c.ink,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Heading({ children, size = 26 }: { children: ReactNode; size?: number }) {
  return (
    <Text
      accessibilityRole="header"
      style={{ fontFamily: font.display, fontSize: size, color: c.ink, letterSpacing: -0.5 }}
    >
      {children}
    </Text>
  );
}

export function Muted({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return (
    <Text style={[{ fontSize: 13, color: c['ink-muted'], fontFamily: font.body }, style]}>
      {children}
    </Text>
  );
}

export function ErrorText({ children }: { children: string | null }) {
  if (!children) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{ backgroundColor: c['danger-bg'], borderRadius: r.control, padding: 12 }}
    >
      <Text style={{ color: c['danger-fg'], fontSize: 14 }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonText: { fontSize: 16, fontFamily: font.semibold },
  card: { borderRadius: r.card, padding: 20, gap: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 24,
    alignItems: 'center',
  },
  rowLabel: { fontSize: 14, color: c['ink-muted'], fontFamily: font.body },
  rowValue: {
    fontSize: 14,
    color: c.ink,
    fontFamily: font.semibold,
    textAlign: 'right',
    flexShrink: 1,
  },
  choice: {
    minHeight: TOUCH,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
});
