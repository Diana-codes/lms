import { Alert } from 'react-native';

/** Ask before something that cannot be undone. Resolves true when confirmed. */
export function confirm(title: string, message: string, ok: string, cancel: string) {
  return new Promise<boolean>((resolve) =>
    Alert.alert(title, message, [
      { text: cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: ok, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}
