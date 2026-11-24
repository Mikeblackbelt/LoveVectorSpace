# LoveVectorSpace frontend

The web app and the Android/iOS apps, from one Vite + React 18 + TypeScript build. It consumes the backend exactly as written in [`docs/api.md`](../docs/api.md). Native shells are Capacitor 8.

Visual source of truth: `.superdesign/design-system.md`, `.superdesign/themes.css` and the approved mockups. All six themes (signal, pulse, riso, blueprint, journal, crt) are tokens in `src/styles/themes.css`; component CSS uses only those variables.

## Run it

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173 — mock API, no backend needed
```

`npm run dev` uses the **mock API** (`VITE_API_MODE=mock`, set in `.env.development`). Any email and password sign you in. The demo data has:

- **Yu Cheng** (potential): 64% (range 49–79), uncalibrated, no safety flags, three next steps, a saved chat thread.
- **Sam** (established): 71% (56–86) with a `concern` pattern warning and plain-text resources.
- **Jordan** (potential): insufficient data.

Agent replies stream as fake SSE (tool-call chips, then tokens). Imports, facts, hangouts, questionnaires, tokens, invites and theme settings all work in memory and reset on reload. To see the agent-unavailable state, turn the agent off in Settings.

Against a real backend:

```bash
npm run dev:live                       # proxies /api to http://localhost:8000
VITE_PROXY_TARGET=http://host:port npm run dev:live
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server, mock API |
| `npm run dev:live` | Dev server, real API through the Vite proxy |
| `npm run build` | Type-check + production build (real API, same origin) into `dist/` |
| `npm run build:mock` | Static demo build with the mock API baked in |
| `npm test` | Vitest + Testing Library |
| `npm run lint` | ESLint |

## Configuration (`.env.example`)

| Variable | Use |
|---|---|
| `VITE_API_MODE` | `mock` or `live` |
| `VITE_API_BASE` | Absolute API origin. Leave empty on the web (served by the backend at `/`). **Required for native builds**, e.g. `https://lvs.example.app`; the server's CORS must allow `capacitor://localhost` and `https://localhost`. |
| `VITE_APPLE_CLIENT_ID`, `VITE_APPLE_REDIRECT_URI` | Sign in with Apple JS (web) and the native plugin |
| `VITE_GOOGLE_WEB_CLIENT_ID`, `VITE_GOOGLE_IOS_CLIENT_ID` | Native Google sign-in plugin (web Google uses the server redirect) |

## How auth works (api.md)

- **Web:** the access JWT lives in memory only. The refresh token is the HttpOnly `lvs_rt` cookie. Every POST/PUT/PATCH/DELETE echoes the `lvs_csrf` cookie as `X-CSRF-Token`. A cold start calls `POST /api/auth/refresh` once.
- **Native:** requests send `X-Client: native`; the refresh token comes back in the JSON body and is kept in the platform keychain/keystore (`@aparajita/capacitor-secure-storage`).
- A 401 triggers one refresh, then one retry. Refresh is single-flight because tokens rotate and reuse revokes the family.
- Google on the web redirects to `/api/auth/google/start` and lands on `/auth/complete#ok`. Apple on the web uses Sign in with Apple JS. Native Google/Apple use `@capgo/capacitor-social-login` and post the ID token to `/api/auth/{google,apple}/token`. A `403 invite_required` asks for an invite code and retries.
- Live updates use `GET /api/events` read with `fetch` streaming (so the JWT goes in the header).

## Security headers

Production builds embed this Content-Security-Policy as a `<meta>` tag (`vite.config.ts`, `cspFor`). `connect-src` adds the origin of `VITE_API_BASE` when it is set (native builds):

```
default-src 'self'; connect-src 'self' <VITE_API_BASE origin>; script-src 'self' https://appleid.cdn-apple.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com;
img-src 'self' data: blob:; base-uri 'self'; form-action 'self' https://appleid.apple.com https://accounts.google.com;
object-src 'none'
```

The backend serving the SPA should send the same value as a `Content-Security-Policy` **header**, plus `frame-ancestors 'none'` (browsers ignore `frame-ancestors` in a meta tag). Live builds contain no mock code: the mock import sits behind the build-time constant `__LVS_MOCK__`.

## Native origins (backend CORS)

The Capacitor webviews call the API cross-origin with `X-Client: native` and no cookies, so the backend CORS allow-list must include:

| Platform | Origin |
|---|---|
| Android | `https://localhost` |
| iOS | `capacitor://localhost` (Capacitor's default scheme; `ios.scheme` in `capacitor.config.ts` only names the Xcode scheme) |

## Android

Needs a JDK 21 and the Android SDK (Android Studio installs both).

```bash
cd frontend
VITE_API_BASE=https://your-backend npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run android:apk` runs the same steps. Open the project in Android Studio with `npx cap open android`.

The app is a **share target** for chat exports: WhatsApp "Export chat" (`.txt`/`.zip`) and `.json` exports shared to LoveVectorSpace open the import flow (pick the person, then "which name is you?"). The intent filters are in `android/app/src/main/AndroidManifest.xml`.

## iOS

The `ios/` project was generated with `npx cap add ios` (Swift Package Manager, no CocoaPods). Building needs macOS and Xcode:

- **On a Mac:** `npm run build && npx cap sync ios && npx cap open ios`, set your team under Signing & Capabilities, add the "Sign in with Apple" capability, then run or archive.
- **Without a Mac:** `.github/workflows/ios.yml` builds on a GitHub macOS runner. It always does an unsigned simulator build; when the signing and App Store Connect secrets listed at the top of the workflow are set, it archives, exports an IPA and uploads it to TestFlight.

iOS has no share extension (designer's call); users import through the Files picker in Sources.

## Layout

```
src/
  api/        api.md types, client (auth, CSRF, refresh, SSE), endpoints, live events, social sign-in
  mock/       in-browser implementation of api.md over synthetic data
  theme/      theme list, provider (AUTO, a11y prefs, server persistence), plain-language labels
  components/ shell (command bar, phone bar, popover, prompt, footer), radar, scope, safety block
  screens/    auth, people, sources/import, dashboard, chat (+ hangout check-in), context, forms, themes, settings, privacy
  intro/      boot intro (canvas port of intro.html) and fun facts
  native/     Capacitor plugins, loaded lazily behind isNativePlatform()
  styles/     themes.css (tokens), base.css (dashboard mockup), app.css (other screens)
```

## Assumed shapes

`docs/api.md` names some shapes without defining them. The client follows the backend pydantic models for these: `ScaleDef`/`ScaleResult` (`src/analyzer/scales/schema.py`), `Fact`, `Interaction` and `SpeakerMapping` (`src/analyzer/store/models.py`). Overlay scale items with `text: null` show `display_text` when present, otherwise the backend placeholder wording ("<scale> item N (enter text from the official form)").

## Safety and privacy rules in the UI

- The safety block renders first on the dashboard. Resources are plain text: no `tel:`/`sms:` links, no call buttons, and `format-detection` stops iOS from linking numbers.
- The headline is never shown without its range and the uncalibrated tag.
- The footer disclaimer is on every screen.
- No analytics. Message text is never logged.
