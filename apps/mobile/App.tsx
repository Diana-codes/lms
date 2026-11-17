import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { hasSession } from './src/lib/api';
import type { Home as HomeData, RegistrationNeeded, Tab } from './src/lib/types';
import { Apply } from './src/screens/Apply';
import { DocumentsScreen } from './src/screens/Documents';
import { Home, type HomeGo } from './src/screens/Home';
import { Register } from './src/screens/Register';
import { SignIn } from './src/screens/SignIn';
import {
  InsightsTab,
  LoansTab,
  NotificationsScreen,
  ProfileTab,
  StatementScreen,
  SupportSheet,
} from './src/screens/Tabs';
import { tap, Toast } from './src/ui';
import { HomeIcon, InsightsIcon, LoansIcon, ProfileIcon } from './src/ui/icons';
import { c, font } from './src/ui/theme';

type Overlay = 'apply' | 'statement' | 'notifications' | 'documents' | null;

const TABS: Array<[Tab, string, typeof HomeIcon]> = [
  ['home', 'Home', HomeIcon],
  ['loans', 'Loans', LoansIcon],
  ['insights', 'Insights', InsightsIcon],
  ['profile', 'Profile', ProfileIcon],
];

/** The bottom tab bar from the Home design. */
function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.tabBar, { paddingBottom: Math.max(14, insets.bottom) }]}
    >
      {TABS.map(([key, label, Icon]) => {
        const on = tab === key;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label}
            onPress={() => {
              if (!on) tap();
              onChange(key);
            }}
            style={styles.tabItem}
          >
            <Icon size={22} color={on ? c.forest : c['ink-muted']} />
            <Text
              style={{
                fontSize: 11,
                color: on ? c.forest : c['ink-muted'],
                fontFamily: on ? font.semibold : font.body,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The borrower app: four tabs (Home, Loans, Insights, Profile) as in the
 * approved Home design, with the apply flow, statement and notifications
 * opening over them. Session tokens live in the device's secure store.
 */
export default function App() {
  const [fontsReady] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    SpaceGrotesk_600SemiBold,
  });
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // A new number that passed the SMS code and is filling in the sign-up form.
  const [registration, setRegistration] = useState<RegistrationNeeded | null>(null);
  const [signInNotice, setSignInNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [support, setSupport] = useState(false);
  const [home, setHome] = useState<HomeData | null>(null);
  const [homeKey, setHomeKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    hasSession().then(setSignedIn);
  }, []);

  const flash = useCallback((message: string) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(message);
    timer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const go = useCallback((to: HomeGo) => {
    if (to === 'schedule') setTab('loans');
    else if (to === 'support') setSupport(true);
    else setOverlay(to);
  }, []);

  if (!fontsReady || signedIn == null)
    return <View style={{ flex: 1, backgroundColor: c.forest }} />;

  if (!signedIn) {
    return (
      <SafeAreaProvider>
        {registration ? (
          <SafeAreaView style={{ flex: 1, backgroundColor: c.ground }}>
            <StatusBar style="dark" />
            <Register
              registrationToken={registration.registrationToken}
              phone={registration.phone}
              onDone={() => {
                setRegistration(null);
                setSignInNotice(null);
                setTab('home');
                setSignedIn(true);
                flash('Welcome to Kora Lend! Your account is open.');
              }}
              onCancel={(message) => {
                setRegistration(null);
                setSignInNotice(message ?? null);
              }}
            />
          </SafeAreaView>
        ) : (
          <SafeAreaView style={{ flex: 1, backgroundColor: c.forest }} edges={['top']}>
            <StatusBar style="light" />
            <SignIn
              notice={signInNotice}
              onRegister={setRegistration}
              onSignedIn={() => {
                setSignInNotice(null);
                setTab('home');
                setSignedIn(true);
              }}
            />
          </SafeAreaView>
        )}
      </SafeAreaProvider>
    );
  }

  const loanCode = home?.loan?.code ?? null;
  const close = () => {
    setOverlay(null);
    setHomeKey((k) => k + 1);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.ground }} edges={['top']}>
        <StatusBar style="dark" />
        {overlay === 'apply' ? (
          <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
            <Apply
              onDone={() => {
                close();
                setTab('home');
              }}
              onCancel={close}
              toast={flash}
            />
          </SafeAreaView>
        ) : overlay === 'statement' && loanCode ? (
          <StatementScreen loanCode={loanCode} onBack={close} />
        ) : overlay === 'notifications' ? (
          <NotificationsScreen onBack={close} />
        ) : overlay === 'documents' ? (
          <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
            <DocumentsScreen onBack={close} toast={flash} />
          </SafeAreaView>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              {tab === 'home' ? (
                <Home key={homeKey} go={go} toast={flash} onLoaded={setHome} />
              ) : null}
              {tab === 'loans' ? (
                <LoansTab loanCode={loanCode} onApply={() => setOverlay('apply')} />
              ) : null}
              {tab === 'insights' ? <InsightsTab /> : null}
              {tab === 'profile' ? (
                <ProfileTab
                  toast={flash}
                  onDocuments={() => setOverlay('documents')}
                  onSignedOut={() => {
                    setHome(null);
                    setSignedIn(false);
                  }}
                />
              ) : null}
            </View>
            <TabBar
              tab={tab}
              onChange={(t) => {
                setTab(t);
                if (t === 'home') setHomeKey((k) => k + 1);
              }}
            />
          </>
        )}
        <SupportSheet open={support} onClose={() => setSupport(false)} home={home} />
        <Toast message={toast} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.line,
    paddingTop: 8,
    paddingHorizontal: 12,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 6, minHeight: 48 },
});
