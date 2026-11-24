// Public surface of the phone-capture feature, for the screens that mount it:
//   SettingsScreen  -> <PhoneCapturePane />
//   SourcesPanel    -> <ScreenshotImportKey pid={pid} /> next to IMPORT CHAT
//   authed Shell    -> <CaptureFlusher />
// Side effect: wipe native capture state whenever a session ends (logout, deletion, refresh denied).
import './session';

export { CaptureFlusher, syncAndFlush } from './CaptureFlusher';
export { clearCaptureState } from './session';
export { ConsentDialog, PhoneCapturePane } from './PhoneCapture';
export { ScreenshotImportDialog, ScreenshotImportKey } from './ScreenshotImport';
export { detectCapabilities, type Capabilities } from './capabilities';
