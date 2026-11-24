// Public surface of the phone-capture feature, for the screens that mount it:
//   SettingsScreen  -> <PhoneCapturePane />
//   SourcesPanel    -> <ScreenshotImportKey pid={pid} /> next to IMPORT CHAT
//   authed Shell    -> <CaptureFlusher />
export { CaptureFlusher, syncAndFlush } from './CaptureFlusher';
export { ConsentDialog, PhoneCapturePane } from './PhoneCapture';
export { ScreenshotImportDialog, ScreenshotImportKey } from './ScreenshotImport';
export { detectCapabilities, type Capabilities } from './capabilities';
