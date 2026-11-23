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
