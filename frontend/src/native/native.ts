// Native (Capacitor) integrations. Every plugin is loaded lazily behind
// isNative() so the web bundle never touches native-only code paths.
import { Capacitor } from '@capacitor/core';
import { isNative, platform } from '../api/config';

export async function applyNativeTheme(bg: string, light: boolean): Promise<void> {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: light ? Style.Light : Style.Dark });
    if (platform() === 'android') await StatusBar.setBackgroundColor({ color: toHex(bg) });
  } catch {
    /* plugin unavailable */
  }
}

function toHex(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const m = c.match(/\d+/g);
  if (!m || m.length < 3) return '#101114';
  return '#' + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('');
}

/** Light haptic tap on primary actions (no-op on the web). */
export function haptic(): void {
  if (!isNative()) return;
  void import('@capacitor/haptics')
    .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }))
    .catch(() => undefined);
}

export async function hideSplash(): Promise<void> {
  if (!isNative()) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 200 });
  } catch {
    /* ignore */
  }
}

export interface SharedChatFile {
  name: string;
  uri: string;
  mimeType: string;
}

/**
 * Android share target: chat exports shared into the app (WhatsApp "Export chat",
 * Files, etc.) arrive here and are routed to the import flow.
 */
export async function listenForSharedFiles(onFile: (f: SharedChatFile) => void): Promise<() => void> {
  if (!isNative()) return () => undefined;
  try {
    const { CapacitorShareTarget } = await import('@capgo/capacitor-share-target');
    const h = await CapacitorShareTarget.addListener('shareReceived', (e) => {
      const f = e.files?.[0];
      if (f) onFile({ name: f.name, uri: f.uri, mimeType: f.mimeType });
    });
    return () => void h.remove();
  } catch {
    return () => undefined;
  }
}

/** Read a shared file URI into a Blob (Capacitor exposes content:// via convertFileSrc). */
export async function readSharedFile(f: SharedChatFile): Promise<Blob> {
  const res = await fetch(Capacitor.convertFileSrc(f.uri));
  return res.blob();
}

// Native Google/Apple sign-in (with a per-attempt nonce) lives in src/api/social.ts.
