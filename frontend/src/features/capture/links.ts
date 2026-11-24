// Linked contacts: the only chats any reader may capture. The list lives natively (the
// services run while the app is closed); these helpers keep edits consistent.
import type { CaptureLink } from './types';

export function normContact(method: CaptureLink['method'], contact: string): string {
  if (method === 'sms') {
    const plus = contact.trim().startsWith('+') ? '+' : '';
    return plus + contact.replace(/\D/g, '');
  }
  return contact.replace(/\s+/g, ' ').trim();
}

export function validateLink(l: CaptureLink): string | null {
  const c = normContact(l.method, l.contact);
  if (!Number.isInteger(l.pid) || l.pid <= 0) return 'Choose a person.';
  if (l.method === 'sms') return c.replace('+', '').length >= 7 ? null : 'Enter a full phone number.';
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
