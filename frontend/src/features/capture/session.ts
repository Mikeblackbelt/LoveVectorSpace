// Ties phone capture to the signed-in account.
//   - Sign-in: bindOwner(userId) natively; a different account wipes the previous state first.
//   - Session end (logout, account deletion, rejected refresh): clearAll() natively + JS consents.
// Capture never runs signed out: the native side refuses to capture or drain without an owner.
import { onClearSession } from '../../api/client';
import { captureEnv, type CaptureEnv } from '../../native/capture';
import { clearLocalConsents } from './consent';

const LEGACY_OWNER_KEY = 'lvs_capture_owner';

function hasCapture(env: CaptureEnv): boolean {
  return env.platform() === 'android' && env.isPluginAvailable('LvsCapture');
}

/** Wipe all capture state (native + JS). Safe to call on any build. */
export async function clearCaptureState(env: CaptureEnv = captureEnv()): Promise<void> {
  clearLocalConsents();
  try {
    localStorage.removeItem(LEGACY_OWNER_KEY);
  } catch {
    /* ignore */
  }
  if (hasCapture(env)) await env.capture().clearAll();
}

/**
 * Bind capture to this account. Returns true if a previous account's state was wiped (the caller
 * should not upload in that pass). The native side writes the owner only after the wipe is durable.
 */
export async function ensureCaptureOwner(env: CaptureEnv, userId: string): Promise<boolean> {
  if (!hasCapture(env)) return false;
  const { result } = await env.capture().bindOwner({ userId });
  if (result === 'reset') clearLocalConsents();
  return result === 'reset';
}

let installed = false;
/** Register the session-end hook once (imported for its side effect by the feature index). */
export function installCaptureSessionHook(): void {
  if (installed) return;
  installed = true;
  onClearSession(() => clearCaptureState());
}

installCaptureSessionHook();
