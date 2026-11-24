import { isNative } from './config';

// Access token: memory only (never persisted on the web).
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}
export function setAccessToken(t: string | null): void {
  accessToken = t;
}

// Refresh token: native only, kept in the platform keychain/keystore.
// On the web the refresh token is the HttpOnly cookie `lvs_rt` and is never visible to JS.
const RT_KEY = 'lvs_refresh_token';

export interface RefreshStore {
  get(): Promise<string | null>;
  set(v: string): Promise<void>;
  clear(): Promise<void>;
}

const secureStore: RefreshStore = {
  async get() {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    const v = await SecureStorage.getItem(RT_KEY);
    return v || null;
  },
  async set(v) {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    await SecureStorage.setItem(RT_KEY, v);
  },
  async clear() {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    await SecureStorage.removeItem(RT_KEY);
  },
};

let override: RefreshStore | null = null;
/** Tests can inject an in-memory store. */
export function setRefreshStore(s: RefreshStore | null): void {
  override = s;
}
export function refreshStore(): RefreshStore | null {
  if (override) return override;
  return isNative() ? secureStore : null;
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
