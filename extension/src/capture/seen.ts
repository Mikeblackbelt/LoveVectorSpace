import type { CapturedMessage, Platform } from "../adapters/types";

export const SEEN_CAP = 20_000;

interface Store {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Small non-cryptographic string hash (cyrb53), so message text is never kept in the seen-set. */
export function hash(s: string): string {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const norm = (t: string) => t.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

function minuteOf(m: CapturedMessage): string {
  const v = m.ts_utc ? Date.parse(m.ts_utc) : m.ts_local ? new Date(m.ts_local).getTime() : NaN;
  return Number.isNaN(v) ? "" : String(Math.floor(v / 60_000));
}

/**
 * Dedup keys for messages visible together, in order: the platform id when there is one, otherwise
 * (minute-rounded time, normalised text, occurrence index). Two identical messages in one minute get
 * occurrence 0 and 1, so both are kept, but the same two seen again later are not re-captured.
 */
export function seenKeys(msgs: CapturedMessage[]): string[] {
  const counts = new Map<string, number>();
  return msgs.map((m) => {
    if (m.platform_msg_id) return `i${m.platform_msg_id}`;
    const base = `${minuteOf(m)}|${m.direction}|${norm(m.text)}`;
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    return hash(`${base}|${n}`);
  });
}

/** Bounded per-chat set of keys, persisted in chrome.storage.local (or memory only when store is null). */
export class SeenSet {
  private keys: string[] = [];
  private set = new Set<string>();
  private staged: string[] = [];
  constructor(
    private store: Store | null = null,
    private storageKey = "",
    private cap = SEEN_CAP,
  ) {}

  static async forChat(platform: Platform, chat_key: string, store: Store = chrome.storage.local as Store): Promise<SeenSet> {
    const key = `seen:${platform}:${chat_key}`;
    const s = new SeenSet(store, key);
    const r = await store.get(key);
    const arr = r[key];
    if (Array.isArray(arr)) {
      s.keys = arr as string[];
      s.set = new Set(s.keys);
    }
    return s;
  }

  has(k: string): boolean {
    return this.set.has(k) || this.staged.includes(k);
  }
  stage(ks: string[]): void {
    for (const k of ks) if (!this.has(k)) this.staged.push(k);
  }
  rollback(): void {
    this.staged = [];
  }
  async commit(): Promise<void> {
    if (this.staged.length === 0) return;
    for (const k of this.staged) {
      this.keys.push(k);
      this.set.add(k);
    }
    this.staged = [];
    if (this.keys.length > this.cap) {
      for (const k of this.keys.splice(0, this.keys.length - this.cap)) this.set.delete(k);
    }
    if (this.store) {
      try {
        await this.store.set({ [this.storageKey]: this.keys });
      } catch {
        /* quota: keep the in-memory set; a re-read later is merged server-side */
      }
    }
  }
}
