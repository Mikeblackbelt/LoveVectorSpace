export function hhmm(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--:--';
  return d.toTimeString().slice(0, 5);
}

export function ymd(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

/** Compact relative time: 2m, 1h, 3d. */
export function ago(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function n(v: number): string {
  return v.toLocaleString('en-US');
}

export function pct(v: number | null | undefined): string {
  return v == null ? '--' : String(Math.round(v));
}

/** Block bar like ██████░░░░ for a 0..1 fraction. */
export function blocks(frac: number, width = 10, full = '█', empty = '░'): string {
  const k = Math.max(0, Math.min(width, Math.round(frac * width)));
  return full.repeat(k) + empty.repeat(width - k);
}

export function timezoneGuess(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
