import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { hasSession } from './src/lib/api';
import { Apply } from './src/screens/Apply';
import { Home } from './src/screens/Home';
import { Notifications, ProfileScreen, Schedule } from './src/screens/More';
import { SignIn } from './src/screens/SignIn';
import { c } from './src/ui/theme';

type Screen = 'loading' | 'signin' | 'home' | 'apply' | 'schedule' | 'profile' | 'notifications';

/**
 * The borrower app. A small hand-rolled stack: the few screens here do not
 * need a router. Session tokens live in the device's secure store.
 */
export default function App() {
  const [fontsReady] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    SpaceGrotesk_600SemiBold,
  });
  const [screen, setScreen] = useState<Screen>('loading');
  const [loanCode, setLoanCode] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    hasSession().then((yes) => setScreen(yes ? 'home' : 'signin'));
  }, []);

  function flash(message: string) {
    if (timer.current) clearTimeout(timer.current);
    setToast(message);
    timer.current = setTimeout(() => setToast(null), 4000);
  }

  if (!fontsReady || screen === 'loading')
    return <View style={{ flex: 1, backgroundColor: c.forest }} />;

  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: screen === 'signin' ? c.forest : c.ground }}
        edges={['top', 'bottom']}
      >
        <StatusBar style={screen === 'signin' ? 'light' : 'dark'} />
        {screen === 'signin' ? <SignIn onSignedIn={() => setScreen('home')} /> : null}
        {screen === 'home' ? (
          <Home
            toast={flash}
            go={(s) => {
              if (s === 'schedule') {
                // The home screen only offers this when there is an active loan.
              }
              setScreen(s);
            }}
          />
        ) : null}
        {screen === 'apply' ? (
          <Apply
            onDone={() => setScreen('home')}
            onCancel={() => setScreen('home')}
            toast={flash}
          />
        ) : null}
        {screen === 'schedule' ? (
          <ScheduleGate
            loanCode={loanCode}
            setLoanCode={setLoanCode}
            onBack={() => setScreen('home')}
          />
        ) : null}
        {screen === 'profile' ? (
          <ProfileScreen onBack={() => setScreen('home')} onSignedOut={() => setScreen('signin')} />
        ) : null}
        {screen === 'notifications' ? <Notifications onBack={() => setScreen('home')} /> : null}
        {toast ? (
          <View style={styles.toast} accessibilityLiveRegion="polite" accessibilityRole="alert">
            <Text style={{ color: c.surface, fontSize: 14 }}>{toast}</Text>
          </View>
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/** Finds the active loan before showing its schedule. */
function ScheduleGate({
  loanCode,
  setLoanCode,
  onBack,
}: {
  loanCode: string | null;
  setLoanCode: (c: string) => void;
  onBack: () => void;
}) {
  useEffect(() => {
    if (loanCode) return;
    import('./src/lib/api').then(({ api }) =>
      api<{ loan: { code: string } | null }>('/app/home').then(
        (h) => h.loan && setLoanCode(h.loan.code),
      ),
    );
  }, [loanCode, setLoanCode]);
  if (!loanCode) return <View style={{ flex: 1, backgroundColor: c.ground }} />;
  return <Schedule loanCode={loanCode} onBack={onBack} />;
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 28,
    backgroundColor: c.ink,
    borderRadius: 14,
    padding: 14,
  },
});
