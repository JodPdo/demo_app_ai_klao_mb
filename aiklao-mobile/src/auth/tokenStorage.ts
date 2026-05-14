import * as SecureStore from 'expo-secure-store';

const KEY_JWT = 'aiklao.jwt';
const KEY_REFRESH = 'aiklao.refresh';
const KEY_USER = 'aiklao.user';

export interface StoredUser {
  id: string;            // backend user id
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
}

/**
 * Wrapper around expo-secure-store
 * บน iOS → Keychain, Android → Encrypted SharedPreferences
 */
export const tokenStorage = {
  async getJwt(): Promise<string | null> {
    return SecureStore.getItemAsync(KEY_JWT);
  },

  async setJwt(token: string): Promise<void> {
    await SecureStore.setItemAsync(KEY_JWT, token);
  },

  async getRefresh(): Promise<string | null> {
    return SecureStore.getItemAsync(KEY_REFRESH);
  },

  async setRefresh(token: string): Promise<void> {
    await SecureStore.setItemAsync(KEY_REFRESH, token);
  },

  async getUser(): Promise<StoredUser | null> {
    const raw = await SecureStore.getItemAsync(KEY_USER);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredUser;
    } catch {
      return null;
    }
  },

  async setUser(user: StoredUser): Promise<void> {
    await SecureStore.setItemAsync(KEY_USER, JSON.stringify(user));
  },

  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(KEY_JWT),
      SecureStore.deleteItemAsync(KEY_REFRESH),
      SecureStore.deleteItemAsync(KEY_USER),
    ]);
  },
};
