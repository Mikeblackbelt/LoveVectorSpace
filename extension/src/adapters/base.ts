import type { Anomaly, Health, Selectors } from "./types";

/** Where an adapter reads the page from. Injectable so tests can run against fixtures. */
export interface PageCtx {
  doc: Document;
  url: () => string;
  /** how long scrollStep waits for older messages to load, ms */
  loadWaitMs?: number;
  now?: () => Date;
}

export const defaultCtx = (): PageCtx => ({ doc: document, url: () => location.href });

export const qs = (root: ParentNode, sel: string | undefined): Element | null => (sel ? root.querySelector(sel) : null);

export function textOf(el: Element | null): string {
  return (el?.textContent ?? "").replace(/‎|‏/g, "").trim();
}

export function anomalyOf(doc: Document, sel: Selectors): Anomaly | null {
  if (qs(doc, sel.captcha)) return "captcha";
  if (qs(doc, sel.login)) return "login";
  if (qs(doc, sel.errorBanner)) return "error_banner";
  return null;
}

export const missing = (what: string): Health => ({ ok: false, reason: `selector not found: ${what}` });

/**
 * Scroll the pane to its top and wait for older rows to appear. Only changes scroll position.
 * Resolves true when new content loaded, false when nothing changed (start of chat).
 */
export async function scrollUpAndWait(scroller: Element | null, countRows: () => number, waitMs: number): Promise<boolean> {
  if (!scroller) return false;
  const beforeRows = countRows();
  const beforeHeight = scroller.scrollHeight;
  scroller.scrollTop = 0;
  const poll = 50;
  for (let waited = 0; waited < waitMs; waited += poll) {
    await new Promise((r) => setTimeout(r, poll));
    if (countRows() !== beforeRows || scroller.scrollHeight !== beforeHeight) return true;
  }
  return false;
}
