// Linked contacts: the only chats any reader may capture. The list lives natively (the
// services run while the app is closed); these helpers keep edits consistent.
import type { CaptureLink } from './types';

export const E164_RE = /^\+[1-9]\d{6,14}$/;
/** Alphanumeric SMS sender ids ("Uber", "BANK"): at least one letter, up to 11 chars. */
export const ALPHA_SENDER_RE = /^(?=.*[A-Za-z])[A-Za-z0-9 ._&-]{2,11}$/;

export function normContact(method: CaptureLink['method'], contact: string): string {
  if (method === 'sms') {
    const t = contact.trim();
    if (/[A-Za-z]/.test(t)) return t;
    const plus = t.startsWith('+') ? '+' : '';
    return plus + t.replace(/\D/g, '');
  }
  return contact.replace(/\s+/g, ' ').trim();
}

/**
 * SMS contacts must already be canonical (E.164, as returned by the native normalizePhone) or an
 * exact alphanumeric sender id; names must be non-empty.
 */
export function validateLink(l: CaptureLink): string | null {
  const c = normContact(l.method, l.contact);
  if (!Number.isInteger(l.pid) || l.pid <= 0) return 'Choose a person.';
  if (l.method === 'sms') {
    return E164_RE.test(c) || ALPHA_SENDER_RE.test(c)
      ? null
      : "Can't recognise that number. Include the country code, e.g. +44 7700 900123.";
  }
  if (!c) return 'Enter the chat name exactly as the app shows it.';
  if (c.length > 80) return 'That name is too long.';
  return null;
}

const same = (a: CaptureLink, b: CaptureLink) =>
  a.method === b.method && a.app === b.app && normContact(a.method, a.contact).toLowerCase() === normContact(b.method, b.contact).toLowerCase();

/** Add or re-point a link (same method+app+contact replaces the old person). */
export function upsertLink(links: CaptureLink[], l: CaptureLink): CaptureLink[] {
  const n = { ...l, contact: normContact(l.method, l.contact) };
  return [...links.filter((x) => !same(x, n)), n];
}

export function removeLink(links: CaptureLink[], l: CaptureLink): CaptureLink[] {
  return links.filter((x) => !same(x, l));
}

// Invisible marks apps wrap names in (U+200B-200F, U+202A-202E, U+2066-2069, U+FEFF); built from
// code points so no invisible characters live in the source. Mirrors ContactGate.normName (Java).
const cp = String.fromCharCode;
const INVISIBLE = new RegExp(`[${cp(0x200b)}-${cp(0x200f)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}${cp(0xfeff)}]`, 'g');

const SPACES = new RegExp(`[\\s${cp(0xa0)}]+`, 'g');

export function normName(s: string): string {
  return s.replace(INVISIBLE, '').replace(SPACES, ' ').trim().toLowerCase();
}

/** Same key the native queue reports as `ck` for this contact's messages. */
export function contactKey(l: Pick<CaptureLink, 'method' | 'app' | 'contact'>): string {
  return `${l.method}|${l.app}|${normName(l.contact)}`;
}
