import { describe, expect, it } from 'vitest';
import { H, W, shot } from './fixtures';
import { APP_PROFILES, cleanText, segmentScreenshot } from './segment';
import type { ChatItem } from './types';

const NOW = new Date(2026, 10, 18, 15, 0);
const seg = (img: Parameters<typeof segmentScreenshot>[0]) => segmentScreenshot(img, { now: NOW });
const brief = (items: ChatItem[]) =>
  items.map((i) => (i.kind === 'bubble' ? `${i.role}:${i.text}` : `sep:${i.raw}`));

describe('segmentScreenshot', () => {
  it('drops header, status bar and input bar; assigns sides by alignment', () => {
    const items = seg(shot([
      { sep: 'Today' },
      { role: 'them', lines: ['hey! how was the hike'] },
      { role: 'me', lines: ['amazing, so tired now'] },
      { role: 'them', lines: ['haha'] },
    ]));
    expect(brief(items)).toEqual(['sep:Today', 'them:hey! how was the hike', 'me:amazing, so tired now', 'them:haha']);
    expect(items[0]).toMatchObject({ kind: 'separator', date: { y: 2026, m: 11, d: 18 } });
  });

  it('joins wrapped lines of one bubble and keeps adjacent bubbles apart', () => {
    const items = seg(shot([
      { role: 'me', lines: ['so I was thinking we could', 'try that new ramen place', 'on friday?'] },
      { role: 'me', lines: ['or saturday works too'] },
      { role: 'them', lines: ['friday!!'] },
    ]));
    expect(brief(items)).toEqual([
      'me:so I was thinking we could try that new ramen place on friday?',
      'me:or saturday works too',
      'them:friday!!',
    ]);
  });

  it('reads bubble times on their own line or inline, and strips read ticks', () => {
    const items = seg(shot([
      { role: 'them', lines: ['are you up?'], time: '11:58 PM' },
      { role: 'me', lines: ['yes ✓✓'], time: '11:59 PM', timeInline: true },
    ]));
    expect(items).toEqual([
      { kind: 'bubble', role: 'them', text: 'are you up?', time: { h: 23, m: 58 } },
      { kind: 'bubble', role: 'me', text: 'yes', time: { h: 23, m: 59 } },
    ]);
  });

  it('treats a full-width bubble by its extent and drops centred system notices', () => {
    const items = seg(shot([
      { system: 'You matched with Alex' },
      { role: 'them', lines: ['a very long opening line that nearly fills the whole bubble width'], width: 860 },
      { sep: 'Mar 9, 10:42 PM' },
      { role: 'me', lines: ['Monday works'] },
    ]));
    expect(brief(items)).toEqual([
      'them:a very long opening line that nearly fills the whole bubble width',
      'sep:Mar 9, 10:42 PM',
      'me:Monday works',
    ]);
    expect(items[1]).toMatchObject({ date: { y: 2026, m: 3, d: 9 }, time: { h: 22, m: 42 } });
  });

  it('header band follows the app profile', () => {
    const img = { width: W, height: H, lines: [{ text: 'near the top', x: 80, y: 260, w: 300, h: 44 }] };
    expect(segmentScreenshot(img, { now: NOW, profile: APP_PROFILES.generic })).toHaveLength(1);
    expect(segmentScreenshot(img, { now: NOW, profile: APP_PROFILES.tinder })).toHaveLength(0);
  });

  it('empty or text-free screenshots give no items', () => {
    expect(seg({ width: W, height: H, lines: [] })).toEqual([]);
    expect(seg({ width: W, height: H, lines: [{ text: ' ✓✓ ', x: 900, y: 500, w: 60, h: 30 }] })).toEqual([]);
  });

  it('cleanText', () => {
    expect(cleanText('hi​  there ✓✓')).toBe('hi there');
  });
});
