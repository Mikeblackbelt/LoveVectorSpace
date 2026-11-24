// Approximate timestamps for screenshot bubbles.
//
// The server needs a timestamp on every message, and orders by it. Bubbles take their date
// from the last separator above them (or the user-chosen fallback date) and their time from
// a time printed in/under the bubble or in the separator. Bubbles without one get strictly
// increasing synthetic seconds next to their neighbours, so the chat order survives.
import { addDays } from './separators';
import type { ChatItem, Hm, Role, Ymd } from './types';

export interface TimedBubble {
  role: Role;
  text: string;
  /** Naive local ISO time (no offset), as `ts_local` expects. */
  ts_local: string;
}

const SEC = 1000;

function naiveMs(d: Ymd, t: Hm): number {
  return Date.UTC(d.y, d.m - 1, d.d, t.h, t.m);
}

function fmt(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

interface Slot {
  role: Role;
  text: string;
  date: Ymd;
  anchor: number | null;
}

export function assignTimestamps(items: ChatItem[], fallbackDate: Ymd): TimedBubble[] {
  let date = fallbackDate;
  let sepTime: Hm | undefined;
  let lastAnchor: { date: Ymd; t: Hm } | null = null;
  const slots: Slot[] = [];

  for (const it of items) {
    if (it.kind === 'separator') {
      if (it.date) {
        date = it.date;
        lastAnchor = null;
      }
      sepTime = it.time;
      continue;
    }
    const t = it.time ?? sepTime;
    sepTime = undefined;
    if (t && lastAnchor && sameDay(lastAnchor.date, date) && t.h * 60 + t.m < lastAnchor.t.h * 60 + lastAnchor.t.m - 6 * 60) {
      // Clock went backwards by hours with no new date separator: past midnight.
      date = addDays(date, 1);
    }
    if (t) lastAnchor = { date, t };
    slots.push({ role: it.role, text: it.text, date, anchor: t ? naiveMs(date, t) : null });
  }

  const out: TimedBubble[] = [];
  let prev = -Infinity;
  slots.forEach((s, i) => {
    let ms: number;
    if (s.anchor != null) {
      ms = s.anchor;
    } else if (prev > -Infinity && sameDay(slots[i - 1]?.date, s.date)) {
      ms = prev + SEC;
    } else {
      // Look ahead for an anchor on the same day and count back from it.
      let j = i + 1;
      while (j < slots.length && slots[j].anchor == null && sameDay(slots[j].date, s.date)) j++;
      const next = slots[j];
      ms = next && next.anchor != null && sameDay(next.date, s.date)
        ? next.anchor - (j - i) * SEC
        : naiveMs(s.date, { h: 12, m: 0 });
    }
    // Never go backwards: keep the visual order.
    if (ms <= prev) ms = prev + SEC;
    prev = ms;
    out.push({ role: s.role, text: s.text, ts_local: fmt(ms) });
  });
  return out;
}

function sameDay(a: Ymd | undefined, b: Ymd): boolean {
  return !!a && a.y === b.y && a.m === b.m && a.d === b.d;
}
