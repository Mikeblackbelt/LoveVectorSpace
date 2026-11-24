const pad = (n: number) => String(n).padStart(2, "0");

export function localIso(y: number, mo: number, d: number, h: number, mi: number, s?: number): string {
  const base = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
  return s === undefined ? base : `${base}:${pad(s)}`;
}

function parseClock(t: string): { h: number; mi: number } | null {
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])?\.?[Mm]?\.?/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2]);
  if (m[3]) {
    const pm = m[3].toLowerCase() === "p";
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (h > 23 || mi > 59) return null;
  return { h, mi };
}

/**
 * WhatsApp's per-message metadata: "[3:45 PM, 11/22/2026] Name: " (US) or "[15:45, 22/11/2026] Name: ".
 * Numeric dates are read as M/D/Y unless the first field can only be a day (> 12) or the year comes first.
 */
export type DateFormat = "auto" | "month_first" | "day_first";

export function parseWhatsAppMeta(meta: string, fmt: DateFormat = "auto"): { ts_local: string; speaker: string } | null {
  const m = /^\s*\[([^\]]+?),\s*([^\]]+?)\]\s*(.*?):\s*$/s.exec(meta);
  if (!m) return null;
  const clock = parseClock(m[1]);
  const dm = /(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})/.exec(m[2]);
  if (!clock || !dm) return null;
  let y: number, mo: number, d: number;
  const [a, b, c] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  if (dm[1].length === 4) [y, mo, d] = [a, b, c];
  else {
    y = c < 100 ? 2000 + c : c;
    if (fmt === "day_first" || (fmt === "auto" && a > 12)) [d, mo] = [a, b];
    else [mo, d] = [a, b];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { ts_local: localIso(y, mo, d, clock.h, clock.mi), speaker: m[3] };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Instagram's between-group timestamps: "Nov 22, 2026, 3:45 PM", "Nov 22, 3:45 PM", "Sat 3:45 PM",
 * "Today 3:45 PM", "Yesterday 3:45 PM" or a bare "3:45 PM". Returns browser-local wall clock.
 */
export function parseLooseTimestamp(text: string, now: Date): string | null {
  const t = text.trim();
  const parsed = parseClock(t);
  const word = t.toLowerCase();
  const hasDate = /[a-z]{3}[a-z]*\.?\s+\d{1,2}/.test(word) || word.startsWith("today") || word.startsWith("yesterday");
  const clock = parsed ?? (hasDate ? { h: 12, mi: 0 } : null); // date-only separators: noon, approx
  if (!clock) return null;
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mon = /([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/.exec(word);
  if (mon && MONTHS.includes(mon[1])) {
    const mo = MONTHS.indexOf(mon[1]) + 1;
    if (mon[3]) return localIso(Number(mon[3]), mo, Number(mon[2]), clock.h, clock.mi);
    // No year shown: assume this year, but a date later than now (+1 day) must be last year ("Nov 22" seen in January).
    let year = base.getFullYear();
    if (new Date(year, mo - 1, Number(mon[2]), clock.h, clock.mi).getTime() > now.getTime() + 86_400_000) year -= 1;
    return localIso(year, mo, Number(mon[2]), clock.h, clock.mi);
  }
  let day = base;
  if (word.startsWith("yesterday")) day = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1);
  else if (!word.startsWith("today")) {
    const wd = WEEKDAYS.indexOf(word.slice(0, 3));
    if (wd >= 0) {
      const back = (base.getDay() - wd + 7) % 7;
      day = new Date(base.getFullYear(), base.getMonth(), base.getDate() - back);
    }
  }
  return localIso(day.getFullYear(), day.getMonth() + 1, day.getDate(), clock.h, clock.mi);
}
