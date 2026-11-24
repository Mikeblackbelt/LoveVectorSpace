import "../theme.css";
import "./popup.css";
import * as api from "../api";
import type { Platform, QueueItem } from "../adapters/types";
import type { ChatContext, TabRequest, TabResponse } from "../messages";
import { getHealth, getKey, getPrefs, getRuns, getSettings, setKey, setLink, setPrefs } from "../storage";
import { mountPopup, type PopupDeps } from "./view";

const root = document.getElementById("root")!;

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id !== undefined && tab.url ? tab : null;
}
async function tabCall(req: TabRequest): Promise<TabResponse | null> {
  const tab = await activeTab();
  if (!tab) return null;
  try {
    return (await chrome.tabs.sendMessage(tab.id!, req)) as TabResponse;
  } catch {
    return null; // not a supported page, or the content script is not there
  }
}

const deps: PopupDeps = {
  configured: async () => {
    const s = await getSettings();
    return !!s.apiBase && !!s.token;
  },
  chat: async (): Promise<ChatContext | null> => {
    const r = await tabCall({ type: "getChat" });
    return r && r.ok && r.chat ? r.chat : null;
  },
  summary: (p, k) => api.extSummary(p, k),
  people: () => api.extPeople(),
  link: async (pid, p, k, pseudonym) => {
    await api.extLink(pid, p, k);
    await setLink(p, k, { person_id: pid, pseudonym });
  },
  unlink: async (p, k) => {
    await api.extUnlink(p, k);
    await setLink(p, k, null);
  },
  startBackfill: async (until) => {
    const r = await tabCall({ type: "startBackfill", until });
    return r && r.ok ? { started: !!r.started, reason: r.reason } : { started: false, reason: "no_page" };
  },
  importPage: async (until) => {
    const r = await tabCall({ type: "importPage", until });
    return r && r.ok ? { started: !!r.started, reason: r.reason } : { started: false, reason: "no_page" };
  },
  stopRun: async () => void (await tabCall({ type: "stopRun" })),
  state: async () => ({
    prefs: await getPrefs(),
    health: await getHealth(),
    runs: await getRuns(),
    queueLength: (await getKey<QueueItem[]>("queue", [])).length,
    queueFull: await getKey<boolean>("queue_full", false),
    storageError: await getKey<boolean>("storage_error", false),
    rejected: await getKey<number>("rejected_count", 0),
    lastFlush: await getKey<{ at: number; sent: number; error?: string } | null>("last_flush", null),
  }),
  savePrefs: setPrefs,
  dismissRejected: () => setKey("rejected_count", 0),
  openOptions: () => void chrome.runtime.openOptionsPage(),
};

void getSettings().then((s) => document.documentElement.setAttribute("data-theme", s.theme));
void mountPopup(root, deps);
// Re-render while a backfill is running so the step counter moves.
chrome.storage.onChanged.addListener((changes) => {
  if ("runs" in changes) void mountPopup(root, deps);
});
export type { Platform };
