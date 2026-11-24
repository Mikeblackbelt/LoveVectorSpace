// Social sign-in, per api.md:
//   Google web    -> full-page redirect to /api/auth/google/start (server does PKCE + callback)
//   Google native -> Capacitor plugin id_token -> POST /api/auth/google/token
//   Apple web     -> Sign in with Apple JS (popup) id_token -> POST /api/auth/apple/token
//   Apple native  -> Capacitor plugin id_token -> POST /api/auth/apple/token
// Every ID-token sign-in first gets a single-use nonce from POST /api/auth/nonce. Google receives it raw,
// Apple receives its sha256 hex; the server accepts the token only if its `nonce` claim matches an issued,
// unexpired, unused nonce (raw or hashed), so a captured token can't be replayed.
import { apiUrl } from './config';
import { api, nativeMode } from './client';
import { auth } from './endpoints';
import type { AuthResult } from './types';

/** Web: full-page redirect; a new user's invite rides along as `invite=`. Success lands on /auth/complete?redirect=…#ok. */
export function googleStartUrl(redirect: string, invite?: string): string {
  const q = new URLSearchParams();
  if (invite) q.set('invite', invite);
  q.set('redirect', redirect);
  return apiUrl(`/api/auth/google/start?${q.toString()}`);
}

/** A fresh single-use nonce issued by the server (10-minute lifetime). */
export async function serverNonce(): Promise<string> {
  const r = await api.post<{ nonce: string; expires_in: number }>('/api/auth/nonce', undefined, { retry: false });
  return r.nonce;
}

/** Lower-case hex sha256 of a string (what Apple expects as `nonce`). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

let socialInit: Promise<void> | null = null;
/** Native sign-in through @capgo/capacitor-social-login. `nonce` is what the provider puts in the token
 *  (Google: the raw server nonce; Apple: its sha256 hex). */
export async function nativeIdToken(provider: 'google' | 'apple', nonce: string): Promise<{ idToken: string; name?: string }> {
  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  if (!socialInit) {
    socialInit = SocialLogin.initialize({
      google: {
        webClientId: import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || undefined,
        iOSClientId: import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID || undefined,
        iOSServerClientId: import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || undefined,
        mode: 'online',
      },
      apple: { clientId: import.meta.env.VITE_APPLE_CLIENT_ID || undefined },
    } as never).catch((e) => {
      socialInit = null;
      throw e;
    });
  }
  await socialInit;
  const options = provider === 'apple' ? { scopes: ['email', 'name'], nonce } : { nonce };
  const r = (await SocialLogin.login({ provider, options } as never)) as {
    result: { idToken?: string | null; profile?: { givenName?: string | null; familyName?: string | null } };
  };
  if (!r.result?.idToken) throw new Error(`${provider === 'apple' ? 'Apple' : 'Google'} did not return an identity token.`);
  const name = [r.result.profile?.givenName, r.result.profile?.familyName].filter(Boolean).join(' ');
  return { idToken: r.result.idToken, name: name || undefined };
}

export async function signInWithGoogle(redirect: string, inviteCode?: string): Promise<AuthResult | null> {
  if (nativeMode()) {
    const nonce = await serverNonce();
    const { idToken } = await nativeIdToken('google', nonce);
    return auth.googleToken(idToken, inviteCode || undefined);
  }
  window.location.assign(googleStartUrl(redirect, inviteCode || undefined));
  return null;
}

interface AppleIDGlobal {
  auth: {
    init(o: { clientId: string; scope: string; redirectURI: string; usePopup: boolean; state?: string; nonce?: string }): void;
    signIn(): Promise<{ authorization: { id_token: string }; user?: { name?: { firstName?: string; lastName?: string } } }>;
  };
}

let appleLoaded: Promise<AppleIDGlobal> | null = null;
function loadAppleJs(): Promise<AppleIDGlobal> {
  if (!appleLoaded) {
    appleLoaded = new Promise((resolve, reject) => {
      const w = window as unknown as { AppleID?: AppleIDGlobal };
      if (w.AppleID) return resolve(w.AppleID);
      const s = document.createElement('script');
      s.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
      s.async = true;
      s.onload = () => (w.AppleID ? resolve(w.AppleID) : reject(new Error('Sign in with Apple did not load.')));
      s.onerror = () => {
        appleLoaded = null;
        reject(new Error('Sign in with Apple could not be reached.'));
      };
      document.head.appendChild(s);
    });
  }
  return appleLoaded;
}

export async function signInWithApple(inviteCode?: string): Promise<AuthResult> {
  if (nativeMode()) {
    const r = await nativeIdToken('apple', await sha256Hex(await serverNonce()));
    return auth.appleToken(r.idToken, inviteCode || undefined, r.name);
  }
  const clientId = import.meta.env.VITE_APPLE_CLIENT_ID;
  if (!clientId) throw new Error('Sign in with Apple is not configured for this site.');
  const AppleID = await loadAppleJs();
  const nonce = await sha256Hex(await serverNonce());
  AppleID.auth.init({
    nonce,
    clientId,
    scope: 'name email',
    redirectURI: import.meta.env.VITE_APPLE_REDIRECT_URI || window.location.origin + '/auth/complete',
    usePopup: true,
  });
  const res = await AppleID.auth.signIn();
  const n = res.user?.name;
  const name = n ? [n.firstName, n.lastName].filter(Boolean).join(' ') : undefined;
  return auth.appleToken(res.authorization.id_token, inviteCode || undefined, name || undefined);
}
