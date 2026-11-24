// Client-side limits for POST /imports/messages: per-message text cap and batch splitting by
// count and encoded size, so a big capture never produces an oversized request.
import type { WireMessage } from './types';

export const MAX_TEXT = 4000;
export const MAX_COUNT = 10_000;
/** Stay under 2 MiB including the JSON envelope. */
export const MAX_BYTES = 2 * 1024 * 1024 - 16 * 1024;

const enc = new TextEncoder();

export function truncateText(s: string): string {
  if (s.length <= MAX_TEXT) return s;
  // Don't split a surrogate pair.
  let cut = MAX_TEXT;
  const c = s.charCodeAt(cut - 1);
  if (c >= 0xd800 && c <= 0xdbff) cut--;
  return s.slice(0, cut);
}

export function bytesOf(v: unknown): number {
  return enc.encode(JSON.stringify(v)).length;
}

/** Split items into batches of at most `maxCount` items and `maxBytes` encoded bytes (plus envelope). */
export function splitBatches<T extends { msg: WireMessage }>(
  items: T[],
  envelopeBytes = 256,
  maxCount = MAX_COUNT,
  maxBytes = MAX_BYTES,
): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = envelopeBytes;
  for (const it of items) {
    const b = bytesOf(it.msg) + 1;
    if (cur.length && (cur.length >= maxCount || size + b > maxBytes)) {
      out.push(cur);
      cur = [];
      size = envelopeBytes;
    }
    cur.push(it);
    size += b;
  }
  if (cur.length) out.push(cur);
  return out;
}
