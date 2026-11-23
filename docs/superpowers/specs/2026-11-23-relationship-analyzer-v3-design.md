# Relationship Analyzer v3: multi-user accounts, auth, mobile apps, themes

*2026-11-23. Addendum to v1 and v2. On conflict, v3 wins over v2, and v2 over v1. Status: approved by the owner; the designer's own calls are listed in §8.*

## 1. What changes

- **Multiple users, invite-only.** This is a hackathon demo. Judges get invites or demo accounts, and the relaxed licences (non-commercial and research-only) are kept.
- **Login:**
  - email and password, with email verification and password reset by email;
  - Sign in with Google;
  - Sign in with Apple, which Apple requires on iOS when Google login is offered.
- **Platforms:**
  - a responsive website for desktop, laptop and phone;
  - Android and iPhone apps built with **Capacitor** from the same React build. They are store-ready, but distributed through TestFlight, an APK or Play internal testing, and the web.
- **UI:**
  - the terminal "Mission Control" design with **6 themes**: signal (default), pulse (pink), riso (playful), blueprint (technical), journal (non-technical) and crt;
  - an adaptive Themes screen with an AUTO mode;
  - the vector-sum boot intro, with fun facts.
  - The source of truth is `.superdesign/design-system.md`, `.superdesign/themes.css` and the mockups in `.superdesign/tmp/*.html`.
- **Unchanged from v2:** the headline "chance of success", shown as uncalibrated plus calibrated (v2 §7c), and warnings-only safety (v2 §7b).
- **The demo person is "Yu Cheng".**

## 2. Superseded

| Was | Now |
|---|---|
| v1 §7.2: single-user password + TOTP (`OWNER_PASSWORD_HASH`, `TOTP_SECRET`) | Accounts (§3). TOTP is dropped. |
| One SQLCipher database keyed by `DB_KEY` | `accounts.db`, keyed by `MASTER_KEY`, plus one SQLCipher database per user at `data/users/<user_id>.db`, each with its own random data key |
| `API_TOKEN` (full access) | Per-user API tokens (kind `api`) and extension tokens (kind `extension`), stored hashed |
| Single-user SPA | A multi-user React SPA, which is also the Capacitor app |

## 3. Accounts and security

**`accounts.db`** (SQLCipher, key `MASTER_KEY`) has these tables:
- `users(id, email UNIQUE, email_verified, display_name, password_hash NULL, google_sub UNIQUE NULL, apple_sub UNIQUE NULL, role 'admin'|'user', wrapped_dek, created_at, deleted_at)`
- `invites(code UNIQUE, created_by, email NULL, used_by NULL, expires_at)`
- `refresh_tokens(id, user_id, family_id, token_hash, device, expires_at, revoked_at, replaced_by)`
- `email_tokens(id, user_id, kind 'verify'|'reset', token_hash, expires_at, used_at)`
- `api_tokens(id, user_id, kind 'api'|'extension', token_hash, created_at, revoked_at, last_used_at)`
- `audit(id, user_id, event, at, ip_hash)`, which never holds message text.

**Per-user data keys.**
- At sign-up, generate a 32-byte random data key (DEK).
- Wrap it with AES-256-GCM (`cryptography` package), using a key derived from `MASTER_KEY` with HKDF-SHA256 and info `"lvs-dek-wrap"`. Store the result as `nonce‖ciphertext`.
- The user's database key is the DEK as hex. The existing `open_db(path, key)` is reused unchanged, and so are the store, scales, signals and safety modules.
- Keep an LRU cache of at most 32 user connections.

**Passwords.**
- Hashed with argon2id, minimum 12 characters, and rejected if found in a bundled list of about 10,000 common passwords.
- Login failures are limited to 5 per 15 minutes per (email, IP).
- Error messages are generic.

**Verification and password reset.**
- Single-use tokens of 32 random bytes; the database stores their sha256.
- Verification links expire after 24 hours and reset links after 30 minutes. A reset revokes all of the user's refresh tokens.
- Mail goes out through the Resend HTTP API (`RESEND_API_KEY`, `MAIL_FROM`). Without a key, a console mailer logs the link.

**Google sign-in.**
- **Web:** the OIDC authorisation-code flow with PKCE (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, callback `/api/auth/google/callback`).
- **Native:** a Capacitor plugin returns an ID token, which the app posts to `/api/auth/google/token`.
- The server verifies the issuer, the audience (any of `GOOGLE_CLIENT_IDS`), the expiry, and the signature against Google's JWKS.
- Accounts are matched by `google_sub` first, then by verified email. A brand-new user also needs a valid invite code.

**Apple sign-in.**
- Web uses Sign in with Apple JS; native uses a Capacitor plugin. Config: `APPLE_CLIENT_IDS`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`.
- The server verifies the identity token against Apple's JWKS (issuer `https://appleid.apple.com`, audience in `APPLE_CLIENT_IDS`).
- Private-relay emails are supported, and the name is stored on first login only.

**Sessions.**
- Access tokens are JWTs signed HS256 with `JWT_SECRET`, lasting 15 minutes, with claims `sub, role, exp`.
- **Web:** the refresh token sits in an HttpOnly, Secure, SameSite=Lax cookie named `lvs_rt`. The access token is kept in memory. Writes that authenticate by cookie also need a double-submit `X-CSRF-Token` header matching the `lvs_csrf` cookie.
- **Native:** the refresh token is returned in the JSON body and kept in Capacitor secure storage.
- Refresh tokens rotate on every refresh. Reusing an old one revokes its whole family.

**Invites, admin and demo accounts.**
- Admins create invites in Settings.
- `ADMIN_EMAIL` bootstraps the first admin at signup or login.
- `SEED_DEMO=1` creates `judge1@demo.lvs` and `judge2@demo.lvs` (password from `DEMO_PASSWORD`), each with synthetic people (Yu Cheng, Sam, Jordan), chats, facts, interactions and analyses.

**Account deletion (required by both app stores).**
- In Settings, export first (JSON of facts, interactions, scale results and metrics, plus raw messages if chosen), then delete.
- Deletion hard-deletes the user's database file, their account row and all their tokens, and writes an audit event.

**Isolation.** Every data route resolves `current_user` and then that user's database. Tests prove user A cannot read user B's data.

**Logging.** Logs never contain message text, fact values, agent content or tokens.

## 4. Mobile apps (Capacitor)

**Project setup.**
- `frontend/` is a Vite + React + TypeScript app with `@capacitor/core`, `@capacitor/ios` and `@capacitor/android`. It also contains the `ios/` and `android/` projects.
- App id `app.lovevectorspace.demo`, name "LoveVectorSpace".
- The API base URL comes from `VITE_API_BASE`. The server's CORS allows `capacitor://localhost`, `https://localhost` and `APP_ORIGIN`.

**Native plugins and features.**
- Status bar colour follows the theme.
- A splash screen, then straight into the boot intro.
- Haptics on primary actions.
- Secure storage for the refresh token.
- Google and Apple sign-in plugins.
- An Android share target that accepts chat-export files. iOS uses the Files picker instead.

**Builds.**
- **Android:** `npm run build && npx cap sync android && cd android && ./gradlew assembleDebug` produces an APK.
- **iOS:** the GitHub Actions workflow `.github/workflows/ios.yml` (macOS runner) builds and uploads to TestFlight when its secrets are set. A Mac can build it locally as documented.

**Store readiness.** `docs/store-readiness.md` covers:
- a privacy-policy page;
- data-safety answers;
- in-app account deletion;
- the 17+ rating;
- Sign in with Apple;
- review notes with demo credentials.

**The capture extension stays desktop-only.** On phones you get the dashboard, chat, imports, questionnaires and hangout logging.

## 5. Frontend

**Themes.**
- All 6 themes are implemented from the `themes.css` tokens, set by `data-theme` on the app root.
- Switch with the T key, the `[T] THEME` control, or the Themes screen (live specimens, plus AUTO by system appearance or time of day).
- The choice is saved per user (server setting `theme`), with localStorage as the fast path.
- The journal theme hides keyboard hints and terminal glyphs, and shows plain-language labels (`data-plain`).

**Boot intro.** A React port of `.superdesign/tmp/intro.html`:
- the vectors hop between octants;
- the camera stays above the floor;
- it shows fun facts;
- it runs on cold start and during full-screen loads;
- it can be skipped with a tap or Esc, and respects reduced-motion settings.

**Screens** follow the mockups:
- **Auth:** login, invite-code sign-up, reset request and reset form, and the Google and Apple buttons.
- **People and sources.**
- **Dashboard:** the radar, the headline (uncalibrated plus calibrated), reciprocity metrics, next steps, the chart and the signals list.
- **Agent chat:** includes the interview and hangout logging.
- **Context.**
- **Questionnaires.**
- **Themes.**
- **Settings:** API and extension tokens, invites for admins, export and account deletion, and the Groq zero-data-retention note.

**Responsive layout.**
- Desktop uses multiple columns.
- On phones there is one column and a bottom bar of at most 5 items, with 44px+ targets and safe-area padding.

## 6. API contract

`docs/api.md` is the binding contract. The backend implements it exactly; the frontend and the extension consume it.

## 7. Unchanged

- The engine (Tasks 1–8b, done).
- The safety rules.
- The headline estimate.
- The extension behaviour (v2 §3, §7a).
- The Groq agent (v2 §5).
- Railway hosting, with a volume holding `accounts.db` and `data/users/`.

## 8. Designer's calls

- Resend for email.
- HS256 JWTs with a 15-minute access token and a 30-day rotating refresh token.
- One SQLCipher file per user rather than Postgres, which reuses the store and gives strong isolation.
- iOS builds on GitHub Actions macOS runners.
- No iOS share extension for now.
- Admin bootstrap through `ADMIN_EMAIL`.
- Demo seeding through `SEED_DEMO`.
