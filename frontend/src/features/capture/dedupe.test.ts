import { describe, expect, it } from 'vitest';
import { mergeScreens, normText, overlapLength, similarity } from './dedupe';
import type { BubbleItem, ChatItem } from './types';

const b = (role: 'me' | 'them', text: string): BubbleItem => ({ kind: 'bubble', role, text });
const texts = (xs: ChatItem[]) => xs.map((x) => (x.kind === 'bubble' ? `${x.role}:${x.text}` : `sep:${x.raw}`));

const A = [b('them', 'hey how was your weekend'), b('me', 'pretty good, went hiking'), b('them', 'oh nice where'), b('me', 'up near the lake')];
const B = [b('them', 'oh nice where'), b('me', 'up near the lake'), b('them', 'I love it there'), b('me', 'we should go together')];

describe('dedupe', () => {
  it('merges the shared run between consecutive screenshots once', () => {
    const r = mergeScreens([A, B]);
    expect(texts(r.items)).toEqual([
      'them:hey how was your weekend', 'me:pretty good, went hiking', 'them:oh nice where',
      'me:up near the lake', 'them:I love it there', 'me:we should go together',
    ]);
    expect(r.gaps).toEqual([]);
  });

  it('tolerates OCR noise inside the overlap', () => {
    const noisy = [b('them', 'oh nlce where'), b('me', 'up near the lake.'), b('them', 'I love it there')];
    expect(overlapLength(A, noisy)).toBe(2);
  });

  it('handles bubbles cut by the screenshot edges', () => {
    // A ends with the top half of a long bubble; B shows it whole.
    const a = [b('them', 'first message here'), b('me', 'so what I was trying to say')];
    const c = [b('me', 'so what I was trying to say is that I really enjoyed it'), b('them', 'me too!')];
    expect(texts(mergeScreens([a, c]).items)).toEqual([
      'them:first message here', 'me:so what I was trying to say is that I really enjoyed it', 'them:me too!',
    ]);
    // B starts with the bottom half of a bubble A showed whole.
    const full = [b('them', 'first message here'), b('me', 'so what I was trying to say is that I really enjoyed it'), b('them', 'me too!')];
    const d = [b('me', 'that I really enjoyed it'), b('them', 'me too!'), b('me', 'next week?')];
    const r = mergeScreens([full, d]);
    expect(texts(r.items)).toEqual([
      'them:first message here', 'me:so what I was trying to say is that I really enjoyed it', 'them:me too!', 'me:next week?',
    ]);
  });

  it('prepends a screenshot picked out of order (scrolled up)', () => {
    const r = mergeScreens([B, A]);
    expect(texts(r.items)[0]).toBe('them:hey how was your weekend');
    expect(r.items).toHaveLength(6);
  });

  it('does not merge on one short common bubble and reports the gap', () => {
    const x = [b('them', 'where are you'), b('me', 'ok')];
    const y = [b('me', 'ok'), b('them', 'cool')];
    const r = mergeScreens([x, y]);
    expect(r.items).toHaveLength(4);
    expect(r.gaps).toEqual([1]);
  });

  it('roles must match for an overlap', () => {
    const x = [b('them', 'see you tomorrow then'), b('me', 'yes good night')];
    const y = [b('me', 'see you tomorrow then'), b('them', 'yes good night')];
    expect(overlapLength(x, y)).toBe(0);
  });

  it('separators take part in the alignment', () => {
    const sep: ChatItem = { kind: 'separator', raw: 'Yesterday' };
    const x = [b('them', 'night!'), sep, b('them', 'good morning sunshine')];
    const y = [sep, b('them', 'good morning sunshine'), b('me', 'morning :)')];
    expect(texts(mergeScreens([x, y]).items)).toEqual(['them:night!', 'sep:Yesterday', 'them:good morning sunshine', 'me:morning :)']);
  });

  it('normText and similarity', () => {
    expect(normText('Héllo,  World!!')).toBe('hello world');
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('kitten', 'sitting')).toBeCloseTo(1 - 3 / 7);
    expect(similarity('', 'x')).toBe(0);
  });
});
