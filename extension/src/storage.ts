import type { Platform } from "./adapters/types";
import type { DateFormat } from "./adapters/time";

export interface Settings {
  apiBase: string;
  token: string;
  theme: string;
  waDateFormat: DateFormat;
}
export interface Prefs {
  enabled: Record<Platform, boolean>;
  catchup: boolean;
  paused: boolean;
}
export interface HealthState {
  ok: boolean;
  reason?: string;
  at: number;
}
export interface RunState {
  kind: "backfill" | "catchup" | "import";
  imported?: number;
  status: "running" | "stopped";
  step: number;
  maxSteps: number;
  reason?: string;
  at: number;
}
export interface LinkEntry {
  person_id: number;
  pseudonym: string;
}

export const THEMES = ["signal", "pulse", "riso", "blueprint", "journal", "matcha", "midnight", "inkwell", "crt"] as const;

export const DEFAULT_SETTINGS: Settings = { apiBase: "", token: "", theme: "signal", waDateFormat: "auto" };
export const DEFAULT_PREFS: Prefs = {
  enabled: { whatsapp: true, discord: true, instagram: true, tinder: true, grindr: true },
  catchup: true,
  paused: false,
};

export async function getKey<T>(key: string, fallback: T): Promise<T> {
  const r = await chrome.storage.local.get(key);
  return (r[key] as T | undefined) ?? fallback;
}
export async function setKey(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export const getSettings = async (): Promise<Settings> => ({ ...DEFAULT_SETTINGS, ...(await getKey<Partial<Settings>>("settings", {})) });
export const getPrefs = async (): Promise<Prefs> => {
  const p = await getKey<Partial<Prefs>>("prefs", {});
  return { ...DEFAULT_PREFS, ...p, enabled: { ...DEFAULT_PREFS.enabled, ...(p.enabled ?? {}) } };
};
export const setPrefs = (p: Prefs) => setKey("prefs", p);
export const linkKey = (platform: Platform, chat_key: string) => `${platform}:${chat_key}`;
export const getLinks = () => getKey<Record<string, LinkEntry>>("links", {});
export async function setLink(platform: Platform, chat_key: string, entry: LinkEntry | null): Promise<void> {
  const links = await getLinks();
  if (entry) links[linkKey(platform, chat_key)] = entry;
  else delete links[linkKey(platform, chat_key)];
  await setKey("links", links);
}
export const getHealth = () => getKey<Partial<Record<Platform, HealthState>>>("health", {});
export async function setHealth(platform: Platform, h: HealthState): Promise<void> {
  const all = await getHealth();
  all[platform] = h;
  await setKey("health", all);
}
export const getRuns = () => getKey<Partial<Record<Platform, RunState>>>("runs", {});
export async function setRun(platform: Platform, r: RunState): Promise<void> {
  const all = await getRuns();
  all[platform] = r;
  await setKey("runs", all);
}
export const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
