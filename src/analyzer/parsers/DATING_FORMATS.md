# Dating-app export formats

Researched 2026-11-23. None of the three apps publishes a schema; shapes come from
community write-ups. Parsers accept key variants and raise `ParseError` naming the
expected file otherwise.

## Tinder - data.json ("Download My Data") - confidence: medium
Believed shape: `{"Messages": [{"match_id": "...", "messages": [{"to", "from", "message", "sent_date"}]}]}`.
Only the owner's sent messages are present; match ids are anonymised. `sent_date` is
seen as RFC 2822 text, ISO 8601 or epoch milliseconds; all are accepted (naive = UTC).
Sources:
- https://towardsdatascience.com/my-friends-gave-me-their-tinder-data-7fcd2621c140
- https://towardsdatascience.com/diving-into-my-tinder-dat-e-a-a508269b8d10
- https://www.help.tinder.com/hc/articles/115005626726-How-do-I-request-a-copy-of-my-personal-data (JSON mentioned, no schema)

## Hinge - matches.json ("Download My Data") - confidence: low-medium
The export folder holds user.json, matches.json, media.json, prompts.json. matches.json
is believed to be a list of per-match objects with optional `like`, `match`, `block`,
`we_met` event lists and `chats: [{"body", "timestamp"}]` (owner's messages only;
timestamps `YYYY-MM-DD HH:MM:SS`, treated as UTC). Key names could not be verified from a
fetched source, and Hinge reportedly changes the export. There is no match id: the
1-based position in the list is used as `match_id`. Matches without chats are not listed.
Sources:
- https://github.com/spottseng/hinge-data-analysis (confirms file names only)
- https://help.hinge.co/hc/en-us/articles/360011235813-How-do-I-request-a-copy-of-my-personal-data

## Grindr - UNCONFIRMED
Grindr documents how to request data (Settings > Security and Privacy > Download My
Data, 15-30 days) and says it includes chats, but no public source describes the file
format. The parser is a best guess: a list or dict of conversations
(`conversations`/`chats`/`messages`), each with an id and a `messages` list, or a flat
message list grouped by a conversation-id key; text under body/text/message/content,
time under timestamp/sent_date/created_at etc. (epoch s/ms, ISO or RFC 2822). If one
sender appears in the whole file it is treated as one-sided owner messages; with several
senders, "me" = sender equal to the owner name or "you". Re-verify against a real export.
Source:
- https://help.grindr.com/hc/en-us/articles/1500005257961-Accessing-your-personal-data
