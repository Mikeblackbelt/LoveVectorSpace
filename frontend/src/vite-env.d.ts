/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_MODE?: string;
  readonly VITE_API_BASE?: string;
  readonly VITE_APPLE_CLIENT_ID?: string;
  readonly VITE_APPLE_REDIRECT_URI?: string;
  readonly VITE_GOOGLE_WEB_CLIENT_ID?: string;
  readonly VITE_GOOGLE_IOS_CLIENT_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** true when built with VITE_API_MODE=mock (vite.config.ts define) */
declare const __LVS_MOCK__: boolean;
