import { describe, expect, it } from 'vitest';
import { fmtLocal, parseSeparator, parseTime, splitTrailingTime } from './separators';

// Wednesday 2026-11-18, 15:00 local.
const NOW = new Date(2026, 10, 18, 15, 0);

describe('parseTime', () => {
  it.each([
    ['10:42 PM', { h: 22, m: 42 }],
    ['10:42pm', { h: 22, m: 42 }],
    ['12:05 AM', { h: 0, m: 5 }],
    ['12:30 p.m.', { h: 12, m: 30 }],
    ['22:15', { h: 22, m: 15 }],
    ['9.05 am', { h: 9, m: 5 }],
  ])('%s', (s, want) => expect(parseTime(s)).toEqual(want));

  it.each(['25:00', '13:00 PM', '10:61', 'see you at 10:42', 'ok'])('rejects %s', (s) => expect(parseTime(s)).toBeNull());
});

describe('splitTrailingTime', () => {
  it('splits a time printed at the end of a bubble, with read ticks', () => {
    expect(splitTrailingTime('see you soon 10:42 PM ✓✓')).toEqual({ text: 'see you soon', time: { h: 22, m: 42 } });
    expect(splitTrailingTime('lunch? 13:05')).toEqual({ text: 'lunch?', time: { h: 13, m: 5 } });
  });
  it('leaves text without a trailing time alone', () => {
    expect(splitTrailingTime('meet at 10:42 tomorrow')).toEqual({ text: 'meet at 10:42 tomorrow' });
  });
});

describe('parseSeparator', () => {
  it('relative days and weekdays', () => {
    expect(parseSeparator('Today', NOW)).toEqual({ date: { y: 2026, m: 11, d: 18 } });
    expect(parseSeparator('YESTERDAY', NOW)).toEqual({ date: { y: 2026, m: 11, d: 17 } });
    expect(parseSeparator('Monday', NOW)).toEqual({ date: { y: 2026, m: 11, d: 16 } });
    // Same weekday as today means a week ago (today would read "Today").
    expect(parseSeparator('Wednesday', NOW)).toEqual({ date: { y: 2026, m: 11, d: 11 } });
  });

  it('dates with and without a year', () => {
    expect(parseSeparator('March 12, 2026', NOW)).toEqual({ date: { y: 2026, m: 3, d: 12 } });
    expect(parseSeparator('12 March 2026', NOW)).toEqual({ date: { y: 2026, m: 3, d: 12 } });
    expect(parseSeparator('Wed, Mar 12', NOW)).toEqual({ date: { y: 2026, m: 3, d: 12 } });
    // A month/day after today belongs to last year.
    expect(parseSeparator('Dec 24', NOW)).toEqual({ date: { y: 2025, m: 12, d: 24 } });
    expect(parseSeparator('2026-02-01', NOW)).toEqual({ date: { y: 2026, m: 2, d: 1 } });
  });

  it('numeric dates: month-first unless impossible or dayFirst', () => {
    expect(parseSeparator('3/12/2026', NOW)).toEqual({ date: { y: 2026, m: 3, d: 12 } });
    expect(parseSeparator('25/03/2026', NOW)).toEqual({ date: { y: 2026, m: 3, d: 25 } });
    expect(parseSeparator('03/12/2026', NOW, true)).toEqual({ date: { y: 2026, m: 12, d: 3 } });
  });

  it('date with time', () => {
    expect(parseSeparator('Yesterday at 9:01 AM', NOW)).toEqual({ date: { y: 2026, m: 11, d: 17 }, time: { h: 9, m: 1 } });
    expect(parseSeparator('Mon, Mar 9, 10:42 PM', NOW)).toEqual({ date: { y: 2026, m: 3, d: 9 }, time: { h: 22, m: 42 } });
    expect(parseSeparator('Today · 22:15', NOW)).toEqual({ date: { y: 2026, m: 11, d: 18 }, time: { h: 22, m: 15 } });
    expect(parseSeparator('10:42 PM', NOW)).toEqual({ time: { h: 22, m: 42 } });
  });

  it('rejects ordinary short messages', () => {
    for (const s of ['Monday works', 'ok', 'today was great', 'Feb 30', 'March madness', '']) {
      expect(parseSeparator(s, NOW)).toBeNull();
    }
  });

  it('formats naive local ISO', () => {
    expect(fmtLocal({ y: 2026, m: 3, d: 9 }, { h: 7, m: 5 }, 3)).toBe('2026-03-09T07:05:03');
  });
});
