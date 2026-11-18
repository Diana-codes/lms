import * as SecureStore from 'expo-secure-store';

/**
 * Small values kept on the device: sign-in tokens and the language choice.
 * On phones they live in the secure store (Keystore on Android, Keychain on
 * iOS). The web build has its own version (storage.web.ts).
 */
export const storage = {
  get: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  set: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value),
  remove: (key: string): Promise<void> => SecureStore.deleteItemAsync(key),
};
