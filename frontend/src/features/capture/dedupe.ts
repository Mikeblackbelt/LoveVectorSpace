// De-duplication of overlapping screenshots by aligning their item sequences.
//
// Consecutive screenshots of a scrolled chat share a run of bubbles: the tail of one is the
// head of the next. Bubbles cut by the image edge appear partially, so the first item of the
// overlap may be a suffix of its counterpart and the last item a prefix. OCR noise is
// tolerated with a normalised edit-distance threshold.
import type { ChatItem } from './types';

export function normText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function textOf(it: ChatItem): string {
  return normText(it.kind === 'bubble' ? it.text : it.raw);
}

/** Levenshtein similarity in [0, 1]. Long strings are compared on their first 300 chars. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  a = a.slice(0, 300);
  b = b.slice(0, 300);
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/** Does `x` (from the earlier screenshot) match `y` (from the later one)? */
function matches(x: ChatItem, y: ChatItem, first: boolean, last: boolean): boolean {
  if (x.kind !== y.kind) return false;
  if (x.kind === 'bubble' && y.kind === 'bubble' && x.role !== y.role) return false;
  const a = textOf(x), b = textOf(y);
  if (!a || !b) return false;
  if (similarity(a, b) >= 0.88) return true;
  // First overlap item of the later shot may be cut at the top: only its end is visible.
  if (first && b.length >= 4 && a.endsWith(b)) return true;
  // Last overlap item of the earlier shot may be cut at the bottom: only its start is visible.
  if (last && a.length >= 4 && b.startsWith(a)) return true;
  return false;
}

function fuller(x: ChatItem, y: ChatItem): ChatItem {
  if (x.kind === 'bubble' && y.kind === 'bubble') {
    const base = y.text.length > x.text.length ? y : x;
    const time = x.time ?? y.time;
    return { ...base, ...(time ? { time } : {}) };
  }
  return x.kind === 'separator' && y.kind === 'separator' && (y.date || y.time) && !x.date ? y : x;
}

/** Largest k such that the last k items of `a` match the first k items of `b`. */
export function overlapLength(a: ChatItem[], b: ChatItem[]): number {
  const max = Math.min(a.length, b.length);
  for (let k = max; k >= 1; k--) {
    let ok = true;
    let chars = 0;
    for (let i = 0; i < k && ok; i++) {
      ok = matches(a[a.length - k + i], b[i], i === 0, i === k - 1);
      chars += textOf(b[i]).length;
    }
    // One short shared bubble ("ok", "haha") is not evidence of overlap.
    if (ok && (k >= 2 || chars >= 15)) return k;
  }
  return 0;
}

function join(a: ChatItem[], b: ChatItem[], k: number): ChatItem[] {
  const head = a.slice(0, a.length - k);
  const shared = a.slice(a.length - k).map((x, i) => fuller(x, b[i]));
  return [...head, ...shared, ...b.slice(k)];
}

export interface MergeResult {
  items: ChatItem[];
  /** Indices (into the input) of screenshots that had no overlap with the ones before them. */
  gaps: number[];
}

/**
 * Merge screenshots in the order given. A screenshot that overlaps the start of what we have
 * (the user scrolled up, or picked out of order) is prepended instead.
 */
export function mergeScreens(screens: ChatItem[][]): MergeResult {
  let items: ChatItem[] = [];
  const gaps: number[] = [];
  screens.forEach((s, idx) => {
    if (idx === 0) {
      items = [...s];
      return;
    }
    const fwd = overlapLength(items, s);
    if (fwd > 0) {
      items = join(items, s, fwd);
      return;
    }
    const back = overlapLength(s, items);
    if (back > 0) {
      items = join(s, items, back);
      return;
    }
    gaps.push(idx);
    items = [...items, ...s];
  });
  return { items, gaps };
}
