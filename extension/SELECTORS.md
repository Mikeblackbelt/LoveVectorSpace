# Selector verification checklist

The selectors in `src/adapters/*.selectors.json` were written against synthetic fixtures shaped like each site.
They have **not** been checked against the real sites. Before relying on capture, verify each platform below in a
logged-in browser (DevTools console: `document.querySelectorAll("<selector>").length`). If a check fails, edit only
the JSON file, rebuild, reload the extension, and update the date here.

Sites change their markup. When the health check fails, the popup shows "update selectors" and that platform captures nothing.

| Platform | Last verified |
|---|---|
| WhatsApp Web | not yet verified |
| Discord DMs | not yet verified |
| Instagram DMs | not yet verified |
| Tinder web | not yet verified |
| Grindr web | not yet verified |
| Bumble web | not yet verified |

Use a throwaway chat for testing. Never paste real message text into an issue or commit.

## WhatsApp Web (`whatsapp.selectors.json`)
Last verified: not yet verified
- [ ] `shell` matches exactly one element once the app has loaded.
- [ ] Open a 1:1 chat. `chatTitle` returns the contact name (its `title` attribute or text). WhatsApp has no chat id in the URL, so the title is the `chat_key`; renaming a contact changes the key.
- [ ] `messageList` and `scroller` match the scrolling message pane.
- [ ] `row` matches one element per message/notice inside it.
- [ ] For a sent message, `outgoing` matches inside its row; for a received one, `incoming` does.
- [ ] `meta` is present on text rows and its `data-pre-plain-text` looks like `[3:45 PM, 11/22/2026] Name: `. Check whether your locale writes day-first (`22/11/2026`); the parser reads M/D/Y unless the first number is above 12, so ambiguous day-first dates (for example `05/06/2026`) would be misread.
- [ ] `text` matches the message text span; image-only rows have no match.
- [ ] Date separators and the encryption notice have neither `incoming` nor `outgoing`.
- [ ] `login` matches only on the QR-code screen. `captcha` and `errorBanner` match nothing in normal use.

## Discord DMs (`discord.selectors.json`)
Last verified: not yet verified
- [ ] Open a DM (`/channels/@me/<id>`). `shell`, `messageList` and `scroller` resolve.
- [ ] `row` matches each message `li`; the id looks like `chat-messages-<channel>-<message>`.
- [ ] `author` appears only on the first message of a group, and `time[datetime]` is on every message (the adapter reads the nearest one above if a row has none).
- [ ] `text` matches `message-content-<id>`; attachment-only messages have no match.
- [ ] `system` matches call and join notices.
- [ ] `selfName` returns your own display name exactly as `author` shows it for your messages (direction depends on this match).
- [ ] `chatTitle` returns the other person's name.
- [ ] `login`, `captcha`, `errorBanner` match nothing in normal use.

## Instagram DMs (`instagram.selectors.json`)
Last verified: not yet verified
- [ ] Open a DM (`/direct/t/<thread>/`). `shell`, `messageList` and `scroller` resolve. Instagram's class names are obfuscated, so these `data-testid` selectors are placeholders and will very likely need replacing.
- [ ] `row` matches each message and each timestamp line.
- [ ] `timeSeparator` matches the timestamps shown between groups and its text parses (for example `Nov 22, 2026, 3:45 PM`, `Yesterday 9:10 PM`).
- [ ] `bubble` matches text bubbles; `outgoing` matches only your own bubbles (Instagram marks them by right alignment, so look for a stable attribute).
- [ ] `text` matches the text node inside a bubble; reels, photos and reactions have none.
- [ ] `chatTitle` returns the other person's name.
- [ ] `login`, `captcha`, `errorBanner` match nothing in normal use.

## After verifying
- [ ] Link a throwaway chat, send yourself a message from another device, and confirm the popup count rises after the next flush (about 30 s).
- [ ] Confirm no element, style or attribute was added to the page (the unit tests check this against fixtures; check once on the real page in the Elements panel).
- [ ] Run a short backfill (back to yesterday) and confirm it stops with a readable reason.

## Tinder web (`tinder.selectors.json`)
Last verified: not yet verified
- [ ] Open a match under `tinder.com/app/messages/<match id>`. `shell`, `messageList` and `scroller` resolve. The `data-lvs` selectors are placeholders; replace them with the real markup.
- [ ] `row` matches each message and each timestamp line; `timeSeparator` text parses (for example `Nov 22, 2026 3:45 PM`; a date-only line is read as noon).
- [ ] `bubble` matches text bubbles and `outgoing` only your own (look for a stable attribute or class, not alignment guesses).
- [ ] `text` matches the text inside a bubble; GIFs, photos and notices have none.
- [ ] `chatTitle` returns the match's name. The `chat_key` is the match id from the URL.
- [ ] `login`, `captcha`, `errorBanner` match nothing in normal use (`[role='alert']` may match harmless toasts; narrow it if backfill stops for no reason).

## Grindr web (`grindr.selectors.json`)
Last verified: not yet verified
- [ ] Open a conversation under `web.grindr.com/messages/<id>`. `shell`, `messageList` and `scroller` resolve. The `data-lvs` selectors are placeholders.
- [ ] `row`, `timeSeparator`, `bubble`, `outgoing`, `text` and `chatTitle`: same checks as Tinder.
- [ ] `login`, `captcha`, `errorBanner` match nothing in normal use.
- [ ] Grindr data is sensitive: use a throwaway chat and never paste real messages anywhere.

## Bumble web (`bumble.selectors.json`)
Last verified: not yet verified
- [ ] Open a connection under `bumble.com/app/connections/<id>` (confirm the real path; the adapter expects `/app/connections/<id>`). `shell`, `messageList` and `scroller` resolve. The `data-lvs` selectors are placeholders.
- [ ] `row`, `timeSeparator`, `bubble`, `outgoing`, `text`, `chatTitle`: same checks as Tinder.
- [ ] `login`, `captcha`, `errorBanner` match nothing in normal use.

## Error banners (all dating/Instagram adapters)
`errorBanner` must be a site-specific container. Generic `[role='alert']` toasts are matched through `errorContainer` and only count when their text matches `errorPattern`. Confirm a normal toast (for example "link copied") does not stop a backfill.

## Direction marker (all adapters except Discord)
Each selectors file has `directionMarker`: it must match every message bubble in BOTH states (sent and received), for example by an attribute that is present with value true or false. If message rows exist and `directionMarker` matches nothing in the document, the health check fails with "direction_marker_missing" and nothing is captured. Separately, when 10 or more message rows are loaded and they all point the same way, capture continues but the batch is flagged `direction_uncertain` and the popup says "Only one side detected". Check on a real two-sided chat that the warning does not appear.
