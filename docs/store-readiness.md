# Store readiness (Google Play and the App Store)

The apps are distributed through TestFlight, an APK or Play internal testing, and the web. This page collects what the stores ask for, so a public listing is a paperwork step rather than an engineering one.

## App identity

| Field | Value |
|---|---|
| App id / bundle id | `app.lovevectorspace.demo` |
| Name | LoveVectorSpace |
| Category | Lifestyle |
| Age rating | **17+** (App Store) / Mature 17+ (IARC questionnaire) |
| Account | Required, invite-only |

**Why 17+:** users import personal chats about romantic relationships, and the app can show pattern warnings about controlling behaviour. It contains no sexual content, gambling, or user-to-user contact.

## Privacy policy

- In-app and web route: **`/privacy`** (public, no sign-in). It is linked from the login screen footer and from Settings → About.
- The store listing must link the deployed URL, for example `https://<your-domain>/privacy`.

## Data safety (Play) and App Privacy (App Store)

| Data type | Collected | Linked to the user | Purpose | Notes |
|---|---|---|---|---|
| Email address | Yes | Yes | Account management | Sign-in, verification and password-reset email |
| Name | Optional | Yes | Account management | Display name; Apple's name on first sign-in only |
| Messages (chat exports the user imports) | Yes | Yes | App functionality | Stored in a per-user encrypted database |
| Other user content (facts, hangout notes, questionnaire answers) | Yes | Yes | App functionality | Same per-user database |
| Sensitive info (relationship context) | Yes | Yes | App functionality | Only what the user enters or imports |
| Device or other IDs | No | — | — | |
| Location | No | — | — | |
| Contacts | No | — | — | The Android SMS/notification readers are not part of this build |
| Diagnostics / analytics | No | — | — | No analytics SDKs, no crash reporters |
| Advertising | No | — | — | |

- **Tracking:** none. No data is used to track users across apps or websites.
- **Sharing:** if the user turns the assistant on, the parts of their data needed to answer a request are sent to the model provider (Groq) for that request, with zero data retention requested. This counts as processing on the developer's behalf, not sharing for the provider's own use.
- **Encryption in transit:** yes (HTTPS only; Android `allowMixedContent` is off).
- **Encryption at rest:** a per-user SQLCipher database with its own random key, wrapped by a server master key.
- **Deletion:** users can delete their account and all data in the app (below), and can request it by email.

## Account deletion (required by both stores)

- **In the app:** Settings → Your data.
  1. *Export* downloads a JSON copy (optionally with raw messages).
  2. *Delete account* requires typing `DELETE MY ACCOUNT`, plus the password for password accounts.
- This calls `DELETE /api/account`, which hard-deletes the user's database file, account row and every token, and writes an audit event that contains no content.
- **For the Play web-deletion requirement:** the same flow works on the website after signing in. Link `https://<your-domain>/settings` as the deletion URL.

## Sign in with Apple

- The app offers Google sign-in, so App Store guideline 4.8 requires Sign in with Apple. It is offered next to Google on every auth screen: native through `@capgo/capacitor-social-login`, web through Sign in with Apple JS.
- In Xcode, add the **Sign in with Apple** capability to the App target. In the Apple Developer portal, enable it for `app.lovevectorspace.demo`, and create a Services ID for the web flow.
- Private-relay email addresses are supported.

## Other review points

- **Not a medical or crisis service.** The footer on every screen says: "This tool offers reflection and pattern warnings. It is not therapy, counselling, or a crisis service."
- **Safety resources are suggestions only.** They are plain text with no call or SMS buttons, and the app never contacts anyone.
- **Estimates are labelled.** The "chance of success" is always shown with its range and the tag "uncalibrated estimate: hand-set weights, not fitted to outcomes".
- **Permissions:** Android requests only `INTERNET`. There is no camera, location, contacts or SMS access in this build.
- **Share target (Android):** the app accepts shared `.txt`, `.zip` and `.json` chat exports.

## Review notes (paste into App Store Connect / Play Console)

```
LoveVectorSpace is an invite-only reflection tool for relationships. Sign-up needs an invite
code, so please use this demo account, which already contains synthetic data
(Yu Cheng, Sam, Jordan — no real people):

  Email:    <DEMO_EMAIL>          (e.g. judge1@demo.lvs)
  Password: <DEMO_PASSWORD>

Things to try: People → Yu Cheng (dashboard), Chat (assistant), Check-ins (questionnaires),
Settings → Your data (export and account deletion), Settings → Theme.
Sam's dashboard shows how pattern warnings look: plain-text resources only, no call buttons.

Sign in with Apple and Google are available. The app is not a medical or crisis service, and
says so on every screen.
```

Replace the placeholders with the seeded demo account (`SEED_DEMO=1`, password from `DEMO_PASSWORD`). Never commit real credentials.

## Checklist before submitting

- [ ] Backend deployed over HTTPS; `VITE_API_BASE` set for the native build.
- [ ] `/privacy` reachable without signing in.
- [ ] Demo account seeded and tested on a fresh install.
- [ ] Apple: Sign in with Apple capability, App Privacy answers as above, 17+ rating.
- [ ] Play: data safety form as above, account deletion URL, content rating questionnaire, target API level current.
- [ ] App icons and splash replaced with final artwork (Capacitor defaults are still in place).
