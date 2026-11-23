# LoveVectorSpace capture extension

Chromium (Chrome, Edge) Manifest V3 extension. It captures messages from chats you explicitly link, on WhatsApp Web,
Discord DMs, Instagram DMs, Tinder web, Grindr web and Bumble web, and uploads them in batches to your own LoveVectorSpace server.

It never sends, reacts, marks as read, calls the platforms' APIs, or injects any UI or style into the pages.
Nothing is read from a chat until you link it to a person in the popup.

## Build and test

```
cd extension
npm install
npm run build     # outputs extension/dist
npm test          # Vitest + jsdom
npm run lint      # tsc + eslint
```

## Install (unpacked)

1. Run `npm run build`.
2. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and choose `extension/dist`.
3. Copy the extension's ID from that page.
4. On the server, set `EXTENSION_ID` to that ID and restart. CORS only allows `chrome-extension://<EXTENSION_ID>` on `/api/ingest` and `/api/ext/*`.
5. In the app's Settings, create an **extension token** (shown once).
6. Open the extension's Options page. Enter the API base URL (the server's origin), paste the token, pick a theme, and Save. Chrome asks permission to reach that origin.
7. **Verify selectors before relying on capture:** follow `SELECTORS.md`. The selectors are written against synthetic fixtures and are "not yet verified" against the real sites.

## Use

Open a 1:1 chat on a supported site, click the extension icon, choose the person, and "Link this chat".
The popup then shows counts only (today, 7 days, total, your share over 30 days), last upload, backfill controls,
per-platform switches, the catch-up switch, and health. Pause stops capture everywhere.

- **Live capture:** new messages in a linked, open chat are queued and uploaded in batches of at most 200, at least 30 s apart. The queue lives in `chrome.storage.local`, holds at most 5,000 messages (then capture pauses and the popup warns), and items are removed only after the server acknowledges them.
- **Backfill:** started from the popup with a "back to" date. One scroll step every 2-4 s, at most 300 steps, then a 10 minute cool-down per platform. It stops at the date, the start of the chat, a login page, captcha or challenge, a failing health check, an error banner, or the tab being hidden for over 60 s. Keep the tab visible while it runs.
- **Catch-up:** when a linked chat is opened, if none of the server's last captured message ids is on screen, a bounded scroll (at most 50 steps) looks for one. Platforms without message ids (WhatsApp) have nothing to compare, so catch-up does nothing there.
- **Import this page:** a one-time read of the open, linked chat (optionally scrolling back to a date, with the same limits as backfill), sent as one import unit (`unit_id = capture:<platform>:<chat_key>:<date>`). It works even if live capture is off, shows progress with a stop button, and uploads what it read even if it stops early. The chat must be linked to a person first.
- **WhatsApp date format:** WhatsApp writes numeric dates in your locale. In Options, choose auto (month-first unless the first number is above 12), month-first or day-first.
- **Selector drift:** if a site's markup changes, the health check fails, that platform captures nothing and the popup shows "update selectors". Edit only `src/adapters/<platform>.selectors.json`.

Discord's rules prohibit automating account actions; using this on Discord is an account risk you accept.

## Data handling

Message text goes from the page to the background worker's local queue, then to your server. The popup and the
`/api/ext/summary` call carry counts only. The token is stored in `chrome.storage.local`.
Timestamps: WhatsApp, Instagram, Tinder and Grindr send browser-local wall-clock times plus the browser's IANA timezone; Discord sends UTC.
