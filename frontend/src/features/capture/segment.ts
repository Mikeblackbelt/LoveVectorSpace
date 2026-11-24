// Bubble segmentation for one chat screenshot, from OCR text lines and their boxes.
//
//   1. Drop the header (contact name, status bar) and footer (input bar) bands.
//   2. Classify each line: centred date/time text -> separator; centred other text -> system
//      notice (dropped); a bare time -> bubble timestamp; anything else -> bubble text.
//   3. Group text lines into bubbles: vertically close, same left edge, compatible side.
//   4. Side from the bubble's horizontal extent: hugging the right edge = me, left = them.
import { parseSeparator, parseTime, splitTrailingTime } from './separators';
import type { BubbleItem, ChatItem, Hm, OcrImage, OcrLine, Role } from './types';

export interface AppProfile {
  label: string;
  /** Fraction of the image height taken by the status bar + chat header. */
  headerFrac: number;
  /** Fraction taken by the message input bar / keyboard. */
  footerFrac: number;
  dayFirst?: boolean;
}

export const APP_PROFILES = {
  generic: { label: 'Other / not sure', headerFrac: 0.1, footerFrac: 0.08 },
  whatsapp: { label: 'WhatsApp', headerFrac: 0.1, footerFrac: 0.08 },
  imessage: { label: 'iMessage / SMS', headerFrac: 0.12, footerFrac: 0.08 },
  instagram: { label: 'Instagram', headerFrac: 0.1, footerFrac: 0.08 },
  tinder: { label: 'Tinder', headerFrac: 0.12, footerFrac: 0.09 },
  hinge: { label: 'Hinge', headerFrac: 0.12, footerFrac: 0.09 },
  bumble: { label: 'Bumble', headerFrac: 0.12, footerFrac: 0.09 },
  grindr: { label: 'Grindr', headerFrac: 0.11, footerFrac: 0.09 },
  discord: { label: 'Discord', headerFrac: 0.1, footerFrac: 0.08 },
} satisfies Record<string, AppProfile>;

export type ProfileId = keyof typeof APP_PROFILES;

export interface SegmentOptions {
  now: Date;
  profile?: AppProfile;
  dayFirst?: boolean;
}

interface Group {
  kind: 'group';
  lines: OcrLine[];
  x: number;
  right: number;
  top: number;
  bottom: number;
  votes: Role[];
  time?: Hm;
}

type Work = Group | Exclude<ChatItem, BubbleItem>;

/** Strip read ticks, zero-width characters and repeated whitespace OCR leaves behind. */
export function cleanText(s: string): string {
  return s
    .replace(/[​-‍﻿]/g, '')
    .replace(/(^|\s)[✓✔√]{1,2}(?=\s|$)/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function sideOf(left: number, right: number, W: number): Role | null {
  const diff = left - right;
  if (Math.abs(diff) < 0.04 * W) return null;
  return diff > 0 ? 'me' : 'them';
}

export function segmentScreenshot(img: OcrImage, opts: SegmentOptions): ChatItem[] {
  const W = img.width || 1;
  const H = img.height || 1;
  const prof = opts.profile ?? APP_PROFILES.generic;
  const dayFirst = opts.dayFirst ?? prof.dayFirst ?? false;
  const top = H * prof.headerFrac;
  const bottom = H * (1 - prof.footerFrac);

  const lines = img.lines
    .map((l) => ({ ...l, text: cleanText(l.text) }))
    .filter((l) => l.text && l.y >= top && l.y + l.h <= bottom)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lh = median(lines.map((l) => l.h)) || 20;

  const work: Work[] = [];
  let pendingTime: { time: Hm; y: number } | null = null;
  const lastGroup = (): Group | null => {
    const w = work[work.length - 1];
    return w && w.kind === 'group' ? w : null;
  };

  for (const l of lines) {
    const cx = l.x + l.w / 2;
    const left = l.x;
    const right = W - (l.x + l.w);
    const t = parseTime(l.text);
    const g0 = lastGroup();
    // A bare time inside or right under the previous bubble (horizontally overlapping it) is
    // that bubble's timestamp, even when it happens to sit near the centre line.
    if (t && g0 && l.y <= g0.bottom + 0.5 * lh && l.y + l.h >= g0.top
        && l.x < g0.right + 0.05 * W && l.x + l.w > g0.x - 0.05 * W) {
      g0.time = t;
      pendingTime = null;
      continue;
    }
    const centred = Math.abs(cx - W / 2) < 0.06 * W && l.w < 0.6 * W;
    if (centred) {
      const sep = parseSeparator(l.text, opts.now, dayFirst);
      if (sep) work.push({ kind: 'separator', raw: l.text, ...sep });
      // Centred non-date text is a system notice ("You matched!", encryption banners): dropped.
      pendingTime = null;
      continue;
    }
    if (t) {
      // A time that may belong to the bubble starting on the same row (sorted just before it).
      pendingTime = { time: t, y: l.y };
      continue;
    }
    const side = sideOf(left, right, W);
    const g = lastGroup();
    const gap = g ? l.y - g.bottom : Infinity;
    const sameCol = g ? Math.abs(l.x - g.x) < 0.05 * W : false;
    const compatible = !g || side == null || g.votes.length === 0 || g.votes.includes(side);
    if (g && gap < 0.6 * lh && sameCol && compatible) {
      g.lines.push(l);
      g.x = Math.min(g.x, l.x);
      g.right = Math.max(g.right, l.x + l.w);
      g.bottom = Math.max(g.bottom, l.y + l.h);
      if (side) g.votes.push(side);
    } else {
      const ng: Group = {
        kind: 'group', lines: [l], x: l.x, right: l.x + l.w, top: l.y, bottom: l.y + l.h, votes: side ? [side] : [],
      };
      if (pendingTime && Math.abs(pendingTime.y - l.y) < 0.6 * lh) ng.time = pendingTime.time;
      work.push(ng);
    }
    pendingTime = null;
  }

  return work.map((w): ChatItem => (w.kind === 'group' ? toBubble(w, W) : w));
}

function toBubble(g: Group, W: number): BubbleItem {
  let role = sideOf(g.x, W - g.right, W);
  if (!role) {
    const me = g.votes.filter((v) => v === 'me').length;
    role = me * 2 > g.votes.length && g.votes.length ? 'me' : 'them';
  }
  const texts = g.lines.map((l) => l.text);
  let time = g.time;
  const last = splitTrailingTime(texts[texts.length - 1]);
  if (last.time) {
    texts[texts.length - 1] = last.text;
    time = time ?? last.time;
  }
  return { kind: 'bubble', role, text: texts.join(' ').trim(), ...(time ? { time } : {}) };
}
