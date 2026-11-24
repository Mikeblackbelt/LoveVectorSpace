// Screenshot pipeline (segment -> merge -> timestamps) and the review step's state.
import { truncateText } from './batches';
import { mergeScreens } from './dedupe';
import { APP_PROFILES, segmentScreenshot, type ProfileId } from './segment';
import { assignTimestamps } from './timestamps';
import type { ImportMessagesBody, OcrImage, Role, Ymd } from './types';

export interface ParseOptions {
  now: Date;
  profile: ProfileId;
  fallbackDate: Ymd;
  dayFirst?: boolean;
}

export interface ReviewBubble {
  id: number;
  role: Role;
  text: string;
  ts_local: string;
  dropped: boolean;
}

export interface ParsedScreens {
  bubbles: ReviewBubble[];
  /** 1-based screenshot numbers that didn't overlap the previous ones (possible missing part). */
  gaps: number[];
}

export function parseScreens(images: OcrImage[], o: ParseOptions): ParsedScreens {
  const profile = APP_PROFILES[o.profile] ?? APP_PROFILES.generic;
  const perShot = images.map((img) => segmentScreenshot(img, { now: o.now, profile, dayFirst: o.dayFirst }));
  const merged = mergeScreens(perShot);
  const timed = assignTimestamps(merged.items, o.fallbackDate);
  return {
    bubbles: timed.map((b, i) => ({ id: i + 1, ...b, dropped: false })),
    gaps: merged.gaps.map((g) => g + 1),
  };
}

export type ReviewAction =
  | { type: 'load'; bubbles: ReviewBubble[] }
  | { type: 'flip'; id: number }
  | { type: 'edit'; id: number; text: string }
  | { type: 'drop'; id: number }
  | { type: 'restore'; id: number };

export function reviewReducer(state: ReviewBubble[], a: ReviewAction): ReviewBubble[] {
  switch (a.type) {
    case 'load':
      return a.bubbles;
    case 'flip':
      return state.map((b) => (b.id === a.id ? { ...b, role: b.role === 'me' ? 'them' : 'me' } : b));
    case 'edit':
      return state.map((b) => (b.id === a.id ? { ...b, text: a.text } : b));
    case 'drop':
      return state.map((b) => (b.id === a.id ? { ...b, dropped: true } : b));
    case 'restore':
      return state.map((b) => (b.id === a.id ? { ...b, dropped: false } : b));
  }
}

/** Kept bubbles with non-blank text, as the import body. Screenshot times are always approx. */
export function buildScreenshotBody(bubbles: ReviewBubble[], tz: string): ImportMessagesBody {
  return {
    source: 'screenshot_import',
    tz,
    messages: bubbles
      .filter((b) => !b.dropped && b.text.trim())
      .map((b) => ({ ts_local: b.ts_local, ts_precision: 'approx' as const, role: b.role, text: truncateText(b.text.trim()) })),
  };
}
