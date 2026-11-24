// Parsing of the date/time text chat apps print between and inside bubbles.
// Every function takes `now` explicitly so results are deterministic in tests.
import type { Hm, Ymd } from './types';

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

const TIME_SRC = String.raw`(\d{1,2})[:.](\d{2})(?:\s*([ap])\.?\s*m\.?)?`;
const TIME_ONLY = new RegExp(String.raw`^${TIME_SRC}$`, 'i');
// Trailing time inside a bubble, optionally followed by read ticks / "edited" markers.
const TRAILING_TIME = new RegExp(String.raw`^(.*?\S)\s+${TIME_SRC}(?:\s*(?:[✓✔√]{1,2}|edited|read|sent|delivered))?\s*$`, 'i');

export function ymdOf(d: Date): Ymd {
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

function addDays(base: Ymd, n: number): Ymd {
  const d = new Date(base.y, base.m - 1, base.d + n);
  return ymdOf(d);
}

function validYmd(y: number, m: number, d: number): Ymd | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  return { y, m, d };
}

function cmpYmd(a: Ymd, b: Ymd): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

/** Parse "10:42 PM", "22:15", "9.05am". Returns null unless the whole string is a time. */
export function parseTime(text: string): Hm | null {
  const m = text.trim().match(TIME_ONLY);
  return m ? toHm(m[1], m[2], m[3]) : null;
}

function toHm(hs: string, ms: string, ap?: string): Hm | null {
  let h = Number(hs);
  const m = Number(ms);
  if (m > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    const pm = ap.toLowerCase() === 'p';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  } else if (h > 23) return null;
  return { h, m };
}

/** "see you soon 10:42 PM ✓✓" -> { text: "see you soon", time: 22:42 }. */
export function splitTrailingTime(text: string): { text: string; time?: Hm } {
  const m = text.match(TRAILING_TIME);
  if (!m) return { text };
  const t = toHm(m[2], m[3], m[4]);
  return t ? { text: m[1], time: t } : { text };
}

/** Year for a month/day without a year: the latest such date that is not after `now`. */
function inferYear(m: number, d: number, now: Date): Ymd | null {
  const today = ymdOf(now);
  const cand = validYmd(today.y, m, d);
  if (cand && cmpYmd(cand, today) <= 0) return cand;
  return validYmd(today.y - 1, m, d);
}

function parseDatePart(s: string, now: Date, dayFirst: boolean): Ymd | null {
  const today = ymdOf(now);
  const t = s.toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t === 'today') return today;
  if (t === 'yesterday') return addDays(today, -1);
  if (t in WEEKDAYS) {
    // Apps show weekday names for the past week; the same weekday as today means a week ago.
    const back = (now.getDay() - WEEKDAYS[t] + 7) % 7 || 7;
    return addDays(today, -back);
  }
  let m: RegExpMatchArray | null;
  // 2026-03-12
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return validYmd(+m[1], +m[2], +m[3]);
  // 12/03/2026, 3/12/26, 12/03
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/))) {
    let a = +m[1], b = +m[2];
    if (a > 12 || (dayFirst && b <= 12)) [a, b] = [b, a]; // a = month, b = day
    if (!m[3]) return inferYear(a, b, now);
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return validYmd(y, a, b);
  }
  // Drop a leading weekday: "wed mar 12", "wednesday 12 march 2026".
  const words = t.split(' ');
  if (words.length > 1 && words[0] in WEEKDAYS) words.shift();
  const rest = words.join(' ');
  // mar 12 [2026] | march 12th 2026
  if ((m = rest.match(/^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/)) && m[1] in MONTHS) {
    return m[3] ? validYmd(+m[3], MONTHS[m[1]], +m[2]) : inferYear(MONTHS[m[1]], +m[2], now);
  }
  // 12 mar [2026] | 12th march 2026
  if ((m = rest.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{4}))?$/)) && m[2] in MONTHS) {
    return m[3] ? validYmd(+m[3], MONTHS[m[2]], +m[1]) : inferYear(MONTHS[m[2]], +m[1], now);
  }
  return null;
}

export interface ParsedSeparator {
  date?: Ymd;
  time?: Hm;
}

/**
 * Parse a separator line. The whole line must be a date, a time, or "date [at] time";
 * anything else (a short message like "Monday works") returns null.
 */
export function parseSeparator(text: string, now: Date, dayFirst = false): ParsedSeparator | null {
  const s = text.replace(/[•·|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 40) return null;
  const time = parseTime(s);
  if (time) return { time };
  // Split off a trailing time: "Yesterday at 9:01 AM", "Mon, Mar 12, 10:42 PM".
  const m = s.match(new RegExp(String.raw`^(.*?)(?:,?\s+at)?,?\s+${TIME_SRC}$`, 'i'));
  if (m) {
    const t = toHm(m[2], m[3], m[4]);
    const d = parseDatePart(m[1], now, dayFirst);
    if (t && d) return { date: d, time: t };
  }
  const d = parseDatePart(s, now, dayFirst);
  return d ? { date: d } : null;
}

export function fmtLocal(d: Ymd, t: Hm, sec = 0): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.y}-${p(d.m)}-${p(d.d)}T${p(t.h)}:${p(t.m)}:${p(sec)}`;
}

export { addDays, cmpYmd };
