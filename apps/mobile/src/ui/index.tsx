import { formatRwf, formatRwfCompact, parseRwf } from '@kora/core';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeftIcon, CheckIcon } from './icons';
import { c, font, r } from './theme';

export const tap = () => Haptics.selectionAsync().catch(() => undefined);

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

type Variant = 'dark' | 'lime' | 'outline' | 'ghost';

/** The designs' buttons: 54px, 16px radius. Dark is the main action on light screens, lime on dark. */
export function Button({
  label,
  onPress,
  variant = 'dark',
  disabled,
  loading,
  height = 54,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  height?: number;
  style?: ViewStyle;
}) {
  const off = disabled || loading;
  const bg =
    off && variant !== 'ghost' && variant !== 'outline'
      ? c.track
      : { dark: c.ink, lime: c.lime, outline: c.surface, ghost: 'transparent' }[variant];
  const fg =
    off && variant !== 'ghost' && variant !== 'outline'
      ? c['ink-muted']
      : { dark: c.surface, lime: c.forest, outline: c.ink, ghost: c['ink-soft'] }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: loading }}
      onPress={() => {
        tap();
        onPress();
      }}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        {
          height,
          borderRadius: height >= 50 ? 16 : 12,
          backgroundColor: bg,
          opacity: pressed ? 0.85 : 1,
        },
        variant === 'outline' && { borderWidth: 1, borderColor: c.field },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontFamily: font.semibold, fontSize: height >= 50 ? 16 : 14 }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** The round back button and three-step progress bar at the top of the apply flow. */
export function StepHeader({
  step,
  title,
  onBack,
}: {
  step: 1 | 2 | 3;
  title: string;
  onBack: () => void;
}) {
  return (
    <View style={styles.stepHeader}>
      <RoundButton label="Back" onPress={onBack}>
        <ArrowLeftIcon size={18} color={c.ink} />
      </RoundButton>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={{ fontSize: 12, color: c['ink-muted'], fontFamily: font.body }}>
          Step {step} of 3 · {title}
        </Text>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {[1, 2, 3].map((i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 99,
                backgroundColor: i <= step ? c.forest : c.track,
              }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

export function RoundButton({
  label,
  onPress,
  children,
  size = 44,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  size?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        { width: size, height: size, borderRadius: size / 2, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {children}
    </Pressable>
  );
}

export function ScreenTitle({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {children}
    </Text>
  );
}

export function Muted({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return (
    <Text
      style={[
        { fontSize: 12, color: c['ink-muted'], fontFamily: font.body, lineHeight: 17 },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 13, color: c.ink, fontFamily: font.semibold }}>{children}</Text>;
}

/** A white card with the designs' 1px border. */
export function Panel({
  children,
  style,
  radius = 20,
}: {
  children: ReactNode;
  style?: ViewStyle;
  radius?: number;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: c.surface,
          borderWidth: 1,
          borderColor: c.line,
          borderRadius: radius,
          padding: 16,
          gap: 14,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** The forest-green card for headline figures. */
export function DarkCard({
  children,
  style,
  radius = 22,
}: {
  children: ReactNode;
  style?: ViewStyle;
  radius?: number;
}) {
  return (
    <View
      style={[{ backgroundColor: c.forest, borderRadius: radius, padding: 20, gap: 14 }, style]}
    >
      {children}
    </View>
  );
}

export function Row({
  label,
  value,
  dark,
  valueStyle,
}: {
  label: string;
  value: ReactNode;
  dark?: boolean;
  valueStyle?: TextStyle;
}) {
  return (
    <View style={styles.row}>
      <Text
        style={{
          fontSize: dark ? 13 : 14,
          color: dark ? c['forest-muted'] : c['ink-muted'],
          fontFamily: font.body,
        }}
      >
        {label}
      </Text>
      {typeof value === 'string' ? (
        <Text
          style={[
            {
              fontSize: dark ? 13 : 14,
              color: dark ? c.surface : c.ink,
              fontFamily: dark ? font.semibold : font.medium,
              textAlign: 'right',
              flexShrink: 1,
            },
            valueStyle,
          ]}
        >
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}

/** A chip or tile that is selected or not: term lengths, loan purposes. */
export function Choice({
  label,
  selected,
  onPress,
  pill,
  style,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  pill?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => {
        tap();
        onPress();
      }}
      style={[
        {
          height: pill ? 44 : 48,
          borderRadius: pill ? r.pill : 14,
          paddingHorizontal: pill ? 16 : 4,
          alignItems: 'center',
          justifyContent: 'center',
        },
        selected
          ? { borderWidth: 2, borderColor: c.forest, backgroundColor: c['success-bg'] }
          : { borderWidth: 1, borderColor: c.field, backgroundColor: c.surface },
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

/** The designs' toggle: forest track and lime knob when on. */
export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => {
        tap();
        onChange(!value);
      }}
      hitSlop={8}
      style={{
        width: 52,
        height: 32,
        borderRadius: 999,
        padding: 3,
        backgroundColor: value ? c.forest : c.switchOff,
        alignItems: value ? 'flex-end' : 'flex-start',
      }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: value ? c.lime : c.surface,
        }}
      />
    </Pressable>
  );
}

export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => {
        tap();
        onChange(!checked);
      }}
      style={{
        flexDirection: 'row',
        gap: 12,
        alignItems: 'flex-start',
        paddingVertical: 4,
        paddingHorizontal: 2,
      }}
    >
      <View
        style={[styles.checkbox, checked && { backgroundColor: c.forest, borderColor: c.forest }]}
      >
        {checked ? <CheckIcon size={14} color={c.lime} strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

/** The MoMo badge used next to wallet rows. */
export function MomoTile() {
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: c.momoTile,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{ fontSize: 11, fontFamily: font.semibold, fontWeight: '700', color: c.momoText }}
      >
        MoMo
      </Text>
    </View>
  );
}

/** A bottom sheet with the grab handle, as in the payment design. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      {/* Lifts the sheet above the keyboard when it has a text field. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close">
          <View style={{ flex: 1, backgroundColor: 'rgba(18,22,20,0.45)' }} />
        </Pressable>
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { paddingBottom: Math.max(28, insets.bottom + 12) }]}
        >
          <View style={styles.handle} />
          <Text
            accessibilityRole="header"
            style={{ fontFamily: font.display, fontSize: 22, color: c.ink }}
          >
            {title}
          </Text>
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 16 }}
            style={{ maxHeight: 520 }}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function GreyBox({ children }: { children: ReactNode }) {
  return (
    <View style={{ backgroundColor: c.ground, borderRadius: 16, padding: 16, gap: 10 }}>
      {children}
    </View>
  );
}

export function ErrorText({ children }: { children: string | null }) {
  if (!children) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{ backgroundColor: c['danger-bg'], borderRadius: 12, padding: 12 }}
    >
      <Text style={{ color: c['danger-fg'], fontSize: 14, fontFamily: font.body }}>{children}</Text>
    </View>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.toast}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: c.lime,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CheckIcon size={13} color={c.forest} strokeWidth={3} />
      </View>
      <Text
        style={{ color: c.surface, fontSize: 14, lineHeight: 20, flex: 1, fontFamily: font.body }}
      >
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  round: {
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: font.display,
    fontSize: 26,
    letterSpacing: -0.5,
    lineHeight: 30,
    color: c.ink,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: c.field,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 12,
    paddingHorizontal: 20,
    gap: 16,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 99, backgroundColor: c.track },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 100,
    backgroundColor: c.ink,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
});
