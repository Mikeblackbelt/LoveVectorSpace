import { describe, expect, it } from 'vitest';
import { shot } from './fixtures';
import { buildScreenshotBody, parseScreens, reviewReducer, type ReviewBubble } from './review';
import { assignTimestamps } from './timestamps';
import type { ChatItem } from './types';

const NOW = new Date(2026, 10, 18, 15, 0);
const FALLBACK = { y: 2026, m: 11, d: 18 };
const bub = (role: 'me' | 'them', text: string, time?: [number, number]): ChatItem =>
  ({ kind: 'bubble', role, text, ...(time ? { time: { h: time[0], m: time[1] } } : {}) });

describe('assignTimestamps', () => {
  it('uses separator dates and bubble times; fills gaps with increasing seconds', () => {
    const r = assignTimestamps([
      { kind: 'separator', raw: 'Mar 9', date: { y: 2026, m: 3, d: 9 } },
      bub('them', 'a'),
      bub('me', 'b', [10, 42]),
      bub('them', 'c'),
      { kind: 'separator', raw: 'Yesterday', date: { y: 2026, m: 11, d: 17 } },
      bub('me', 'd'),
    ], FALLBACK);
    expect(r.map((x) => x.ts_local)).toEqual([
      '2026-03-09T10:41:59', // counted back from the next anchor
      '2026-03-09T10:42:00',
      '2026-03-09T10:42:01',
      '2026-11-17T12:00:00', // no time anywhere that day: noon
    ]);
  });

  it('falls back to the chosen date and keeps order strictly increasing', () => {
    const r = assignTimestamps([bub('them', 'x', [9, 0]), bub('me', 'y', [9, 0]), bub('them', 'z', [8, 59])], FALLBACK);
    expect(r.map((x) => x.ts_local)).toEqual(['2026-11-18T09:00:00', '2026-11-18T09:00:01', '2026-11-18T09:00:02']);
  });

  it('a separator time anchors the next bubble; midnight rollover advances the date', () => {
    const r = assignTimestamps([
      { kind: 'separator', raw: 'Mar 9, 11:50 PM', date: { y: 2026, m: 3, d: 9 }, time: { h: 23, m: 50 } },
      bub('them', 'late'),
      bub('me', 'later', [0, 10]),
    ], FALLBACK);
    expect(r.map((x) => x.ts_local)).toEqual(['2026-03-09T23:50:00', '2026-03-10T00:10:00']);
  });
});

describe('screenshot pipeline + review', () => {
  const shots = [
    shot([
      { sep: 'Yesterday' },
      { role: 'them', lines: ['did you get home ok'], time: '11:02 PM' },
      { role: 'me', lines: ['yes! thanks for tonight'], time: '11:05 PM' },
    ]),
    shot([
      { role: 'me', lines: ['yes! thanks for tonight'], time: '11:05 PM' },
      { role: 'them', lines: ['same time next week?'], time: '11:06 PM' },
    ], 800),
  ];

  it('parses, merges and times overlapping screenshots', () => {
    const r = parseScreens(shots, { now: NOW, profile: 'whatsapp', fallbackDate: FALLBACK });
    expect(r.gaps).toEqual([]);
    expect(r.bubbles.map((b) => [b.role, b.text, b.ts_local])).toEqual([
      ['them', 'did you get home ok', '2026-11-17T23:02:00'],
      ['me', 'yes! thanks for tonight', '2026-11-17T23:05:00'],
      ['them', 'same time next week?', '2026-11-17T23:06:00'],
    ]);
  });

  it('review actions and the import body', () => {
    let s: ReviewBubble[] = parseScreens(shots, { now: NOW, profile: 'whatsapp', fallbackDate: FALLBACK }).bubbles;
    s = reviewReducer(s, { type: 'flip', id: 1 });
    s = reviewReducer(s, { type: 'edit', id: 2, text: '  yes!! thanks for tonight ' });
    s = reviewReducer(s, { type: 'drop', id: 3 });
    expect(buildScreenshotBody(s, 'Europe/London')).toEqual({
      source: 'screenshot_import',
      tz: 'Europe/London',
      messages: [
        { ts_local: '2026-11-17T23:02:00', ts_precision: 'approx', role: 'me', text: 'did you get home ok' },
        { ts_local: '2026-11-17T23:05:00', ts_precision: 'approx', role: 'me', text: 'yes!! thanks for tonight' },
      ],
    });
    s = reviewReducer(s, { type: 'restore', id: 3 });
    s = reviewReducer(s, { type: 'edit', id: 1, text: '   ' });
    expect(buildScreenshotBody(s, 'UTC').messages.map((m) => m.text)).toEqual(['yes!! thanks for tonight', 'same time next week?']);
  });
});
