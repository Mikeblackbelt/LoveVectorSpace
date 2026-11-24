# Phone capture (mobile apps)

How the Capacitor apps read chats on a phone (spec §11). Every path is started by the user or explicitly opted into, captures **linked contacts only**, and feeds the normal import pipeline through `POST /api/people/{pid}/imports/messages` (see `docs/api.md`).

| Method | Platforms | Build | Source name | Sides |
|---|---|---|---|---|
| Screenshot import | iOS, Android | all | `screenshot_import` | both (from bubble position) |
| Notification reader | Android | `sideload` | `android_notify_<app>` | them only (one-sided) |
| SMS reader | Android | `sideload` | `android_sms` | both |
| Accessibility chat reader | Android | `sideload` | `android_a11y_<app>` | both |

The web build offers none of these. iOS cannot read other apps at all, so it has screenshot import plus the Files picker.

## How each method works

### Screenshot import
1. Sources → **Import screenshots**. The user picks screenshots of one chat (multi-select).
2. Each image is read into memory and passed to the app's own `LvsOcr` plugin: Google ML Kit text recognition (bundled Latin model) on Android, Apple Vision on iOS. The plugin returns text lines with pixel boxes. **The image is never written to disk or uploaded.**
3. `src/features/capture/segment.ts` turns the lines into bubbles:
   - It drops the header band (status bar, contact name) and the footer band (input bar). Band sizes come from the app picked in review.
   - Centred text that parses as a date or time is a **separator**. Other centred text ("You matched!", encryption banners) is dropped.
   - A bare time inside or right under a bubble is that bubble's time. A trailing time and read ticks are stripped from the bubble text.
   - Lines group into a bubble when they are vertically close, share a left edge and have a compatible side.
   - **Side:** a bubble hugging the right edge is *me*, one hugging the left is *them*.
4. `dedupe.ts` merges overlapping screenshots by aligning their bubble sequences. It tolerates OCR noise (normalised edit distance), handles bubbles cut at the image edge, and accepts screenshots picked out of order. A screenshot with no overlap is flagged as a possible gap.
5. `timestamps.ts` sets timestamps. The date comes from the last separator (relative days, weekdays and dates in several formats, all resolved against the screenshot's own date). The time comes from the bubble or the separator. Bubbles with neither get strictly increasing synthetic seconds, so order survives. All screenshot timestamps are `ts_precision: "approx"`.
6. **Review screen.** The user can flip a bubble's side, edit its text, drop or restore it, and set the person, the app (which re-reads the screenshots), the time zone and the date for undated messages. Only then does the import POST run.

### Notification reader (sideload)
- `LvsNotificationListener` (a `NotificationListenerService`) sees notifications only after the user grants **Notification access**.
- It ignores every package except WhatsApp (and WhatsApp Business), Instagram, Tinder, Grindr, Bumble and Discord (`CaptureApps.java`).
- Group summaries, group conversations, the user's own messages, "3 new messages" summaries and content-hidden placeholders are skipped (`NotificationGate.java`). Some apps put the sender in the text ("Sam: hey"); that is unpacked.
- The chat title must **exactly** match a linked contact for that app after normalisation (case, spaces, bidi marks), so "Sam" never matches "Samantha" (`ContactGate.java`). **Unlinked notifications are dropped immediately and never stored.**
- Matches are queued, encrypted, as `role: them`, with `ts_utc` from the message timestamp. The server marks these imports `one_sided` unless the person has another source.

### SMS reader (sideload)
- Needs `READ_SMS`. It reads only when the app is open (on start, resume, every 10 minutes, or **Upload now**).
- For each linked number, it queries SMS rows `WHERE address LIKE '%<last 7 digits>'` since the last sync and re-checks each row with `phoneMatches` (last 10 digits).
- Inbox rows become *them* and sent rows become *me*. Drafts, outbox and failed rows are skipped.
- MMS text parts are read from the same threads only. Group MMS (more than one other party) and attachments are skipped.
- The first sync of a new number looks back 180 days. After that a per-number cursor is kept.

### Accessibility chat reader (sideload, off by default)
- `LvsAccessibilityService`'s config sets `packageNames` to the allowlist: WhatsApp (+ Business), Instagram, Tinder, Hinge, Grindr, Bumble, Discord and Google Messages. **Android never delivers other apps' events to it.**
- It reads the window only when both of these hold:
  - a text node in the top 20% of the screen exactly matches a contact linked for that app (the chat title);
  - there is a message input box in the lower part of the screen (it is a chat, not a list).
- **Password nodes (`isPassword`) and editable fields are skipped without reading their text**, and so are their children. The input box is used only for its position.
- `BubbleParser.java` assigns sides from node bounds (nearer the right edge = me), reads centred separators and bubble times, and drops centred system notices. `TimeAssigner.java` builds `ts_local`: `minute` precision when both date and time were on screen, `approx` otherwise.
- Repeats from scrolling are skipped with a hashed seen-set, and the server merges anything that slips through.
- **Auto-pause:** after 30 minutes without a linked chat, the chat reader pauses itself. The notification offers "Resume chat reader".

### Controls shared by the readers
- A persistent "Capturing linked chats" notification lists the active readers and the queued count, with a one-tap **Pause/Resume**.
- Settings → **Phone capture** shows:
  - each method with its explanation and a consent screen, which must be agreed before a reader can be turned on;
  - on/off switches, and a button to grant Android access;
  - linked contacts per method, with *Unlink* (also purges that contact's queue) and *Delete captured data*: queued only, or queued plus the uploaded units of that source for that person;
  - pause all, and upload now.
- Upload: `CaptureFlusher` (mounted in the signed-in shell) runs SMS sync and then drains the queue → `POST /imports/messages` grouped by (person, source, tz) → acks only after a 2xx.
  - Offline, 401, 429 or 5xx: the items stay queued.
  - 400, 404 or 422 (a bad batch, or a deleted person): the items are dropped, so one bad batch can't jam the queue.

## Permissions

| Flavour | Manifest additions |
|---|---|
| `store` | none beyond `INTERNET`. Its manifest also strips `READ_SMS`/`RECEIVE_SMS` in case a library adds them. |
| `sideload` | `READ_SMS`, `POST_NOTIFICATIONS`. `LvsNotificationListener` (protected by `BIND_NOTIFICATION_LISTENER_SERVICE`). `LvsAccessibilityService` (protected by `BIND_ACCESSIBILITY_SERVICE`, `res/xml/lvs_accessibility_config.xml`). `CaptureControlReceiver` (not exported). |

Notification access and the accessibility service are granted in system settings; the app opens the right screen. **Android 13+ blocks both for apps installed from an APK** until the user opens App info → ⋮ → **Allow restricted settings**. The app shows this hint and an "Open app info" link.

## Privacy guarantees
- Only linked chats are captured. Gating happens natively before anything is written. Unlinked contacts are never stored.
- Screenshot images never leave the device, and only reviewed text is uploaded.
- The queue, linked contacts, cursors and seen-hashes live in one file in `noBackupFilesDir`, encrypted with AES-256-GCM under a non-exportable Android Keystore key (`CryptoBox.java`). `allowBackup` is false. The seen-set stores truncated SHA-256 hashes, not text.
- **No message text is logged**, in Java or JS. Errors carry only class names or generic messages.
- Pause, unlink and per-contact delete are always one tap away.

## Builds

```bash
cd frontend
npm ci
npm run build && npx cap sync android
cd android
./gradlew assembleStoreDebug       # app/build/outputs/apk/store/debug/app-store-debug.apk
./gradlew assembleSideloadDebug    # app/build/outputs/apk/sideload/debug/app-sideload-debug.apk  (judges' demo)
./gradlew testSideloadDebugUnitTest   # JUnit: BubbleParser, ContactGate, NotificationGate, CaptureQueue, TimeParser
```

Both flavours share the `applicationId`, so Google sign-in and the share target keep working. Install only one at a time. The sideload build has `versionNameSuffix "-sideload"`. `npm run android:apk` (`assembleDebug`) builds both.

On the JS side, `detectCapabilities()` decides what to show: `Capacitor.isPluginAvailable('LvsCapture')` means sideload, `LvsOcr` means screenshot import, and the web shows neither. Unavailable options are hidden.

### iOS setup (one-time, needs a Mac)
`frontend/ios/App/App/Capture/` contains `LvsOcrPlugin.swift` (Apple Vision) and `LvsBridgeViewController.swift`. They are **compile-untested** and not yet in the Xcode target. To wire them in:
1. In Xcode, add the `Capture` folder to the **App** target.
2. In `Base.lproj/Main.storyboard`, set the view controller's custom class to `LvsBridgeViewController` (module `App`) instead of `CAPBridgeViewController` (module `Capacitor`).
3. Build. Screenshot import appears automatically once `LvsOcr` is registered.

## Testing on a device
1. Install the sideload APK. On Android 13+, allow restricted settings (above).
2. Sign in, create a person, then go to Settings → Phone capture.
   - **Notification reader:** Set up → agree → grant Notification access. Link the chat name exactly as the notification title shows it, e.g. "Sam" in WhatsApp. Have that contact message you, then tap *Upload now* and check the person's Sources for an `android_notify_whatsapp` unit.
   - **SMS reader:** Set up → agree → allow SMS. Link the phone number, then tap *Upload now*. Expect an `android_sms` unit with both sides.
   - **Accessibility chat reader:** Set up → agree → switch on "LoveVectorSpace chat reader" in Accessibility. If more than 30 minutes have passed since you turned it on, it has idle-paused: tap *Resume chat reader* first. Link the chat title for, e.g., Hinge, open that chat and scroll, then return to the app. Expect an `android_a11y_hinge` unit. Open an unlinked chat and confirm the queue count does not move.
3. Pause from the notification and confirm nothing new is queued.
4. **Screenshot import:** take two overlapping screenshots of a chat, then go to Sources → Import screenshots. Check the sides and dates, flip or drop a bubble, and import.

Automated tests:
- `npm test` covers the TS segmentation, separators, dedupe, timestamps, review, queue/flush with a fake plugin, consent gating, flavour detection and the UI flows.
- `./gradlew testSideloadDebugUnitTest` covers the Java core.

## Known limitations
- **OCR accuracy.**
  - Stylised fonts, emoji-only bubbles, images, stickers and reactions are missed or garbled.
  - Bands and thresholds are tuned on synthetic layouts; real apps vary by device and version, so the review step is essential.
  - Numeric dates are read month-first unless the first number is over 12.
  - Very large images are downscaled.
  - The base64 bridge transfer of big screenshots is slow on older phones.
- **Notification text truncation.**
  - Notifications may carry shortened text, only the latest message, or nothing at all: Tinder, Bumble and Grindr often show "New message", which is skipped.
  - The user's own replies are never in notifications.
  - Instagram titles use usernames, so link the name exactly as the notification shows it.
- **Accessibility layout changes.**
  - Title detection is generic: an exact linked name in the top 20%, plus an input box.
  - Bubble sides come from node bounds. App updates that change layout, RTL layouts or bubble grouping can break this.
  - Sender names in group chats are not handled; link one-to-one chats only.
  - Bubbles with no time on screen get approximate times near "now" (today) or noon (other days).
  - **Date assumption:** bubbles with no date separator visible above them are assumed to be from today. Opening an old chat stamps the visible old messages with today's date. Scrolling up until a separator shows re-captures them under the right date, but the wrongly dated copies stay. Scroll to a separator before relying on dates, or delete the unit and re-capture.
- **Switching accounts:** the first account to sign in on a phone owns its capture state. If a different account signs in, linked contacts, the queue, reader switches and consents are cleared, so one account's captures never reach another account's person ids. Anything not yet uploaded is lost.
- **SMS:** MMS-only threads (no SMS row in the window) are not found, group MMS is skipped, and the first sync is limited to 180 days.
- **"Persistent" notification:** it is an ongoing notification, not a foreground service. On Android 14+ users can swipe it away, and it reappears on the next capture or state change.
- **Not compiled here:** the Java code and the JUnit tests were written without a JDK, and the Swift without a Mac. The first Gradle and Xcode builds may surface small fixes.

## Files
- TS: `frontend/src/features/capture/` holds the logic, UI and tests (`index.ts` lists the mount points). `frontend/src/native/capture.ts` holds the plugin interfaces and `setCaptureEnv` for test fakes.
- Android:
  - `frontend/android/app/src/main/.../capture/OcrPlugin.java`
  - `src/store/` (no-op `FlavorPlugins`, manifest strip)
  - `src/sideload/` (plugin, services, store, manifest, res)
  - `src/testSideload/` (JUnit)
- iOS: `frontend/ios/App/App/Capture/`.
