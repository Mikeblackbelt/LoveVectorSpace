// Which capture methods this build/device offers. The web build has none; both Android
// flavours and iOS have screenshot import (LvsOcr); only the Android sideload flavour ships
// LvsCapture, whose status() says which readers its manifest declares.
import { captureEnv, type CaptureEnv, type CaptureStatus } from '../../native/capture';

export interface Capabilities {
  platform: 'web' | 'android' | 'ios';
  screenshot: boolean;
  /** 'sideload' when LvsCapture is present, 'store' on Android without it. */
  flavour: 'web' | 'ios' | 'store' | 'sideload';
  notify: boolean;
  sms: boolean;
  a11y: boolean;
  status: CaptureStatus | null;
}

export const NO_CAPS: Capabilities = {
  platform: 'web', screenshot: false, flavour: 'web', notify: false, sms: false, a11y: false, status: null,
};

export async function detectCapabilities(env: CaptureEnv = captureEnv()): Promise<Capabilities> {
  const platform = env.platform();
  if (platform === 'web') return NO_CAPS;
  const screenshot = env.isPluginAvailable('LvsOcr');
  if (platform === 'ios') return { ...NO_CAPS, platform, screenshot, flavour: 'ios' };
  if (!env.isPluginAvailable('LvsCapture')) return { ...NO_CAPS, platform, screenshot, flavour: 'store' };
  let status: CaptureStatus | null = null;
  try {
    status = await env.capture().status();
  } catch {
    status = null;
  }
  const m = status?.methods;
  return {
    platform,
    screenshot,
    flavour: 'sideload',
    notify: !!m?.notify.supported,
    sms: !!m?.sms.supported,
    a11y: !!m?.a11y.supported,
    status,
  };
}
