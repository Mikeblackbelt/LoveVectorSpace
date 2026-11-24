// Social sign-in, per api.md:
//   Google web    -> full-page redirect to /api/auth/google/start (server does PKCE + callback)
//   Google native -> Capacitor plugin id_token -> POST /api/auth/google/token
//   Apple web     -> Sign in with Apple JS (popup) id_token -> POST /api/auth/apple/token
//   Apple native  -> Capacitor plugin id_token -> POST /api/auth/apple/token
import { apiUrl } from './config';
import { nativeMode } from './client';
import { auth } from './endpoints';
import type { AuthResult } from './types';
import { nativeAppleIdToken, nativeGoogleIdToken } from '../native/native';

export function googleStartUrl(redirect: string): string {
  return apiUrl(`/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`);
}

export async function signInWithGoogle(redirect: string, inviteCode?: string): Promise<AuthResult | null> {
  if (nativeMode()) {
    const idToken = await nativeGoogleIdToken();
    return auth.googleToken(idToken, inviteCode || undefined);
  }
  window.location.assign(googleStartUrl(redirect));
  return null;
}

interface AppleIDGlobal {
  auth: {
    init(o: { clientId: string; scope: string; redirectURI: string; usePopup: boolean; state?: string }): void;
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
    const r = await nativeAppleIdToken();
    return auth.appleToken(r.idToken, inviteCode || undefined, r.name);
  }
  const clientId = import.meta.env.VITE_APPLE_CLIENT_ID;
  if (!clientId) throw new Error('Sign in with Apple is not configured for this site.');
  const AppleID = await loadAppleJs();
  AppleID.auth.init({
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
