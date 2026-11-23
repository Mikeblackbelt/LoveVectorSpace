import type { CapturedMessage, Platform } from "./adapters/types";
import { getSettings } from "./storage";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface Person {
  id: number;
  pseudonym: string;
}
/** Counts only. The server never returns message text here. */
export interface ExtSummary {
  linked: boolean;
  person: Person | null;
  total: number;
  today: number;
  last7d: number;
  my_share_30d: number | null;
  last_captured_ts: string | null;
  last_captured_ids: string[];
}
export interface CaptureBatch {
  platform: Platform;
  chat_key: string;
  tz: string;
  unit_id?: string;
  messages: CapturedMessage[];
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const s = await getSettings();
  if (!s.apiBase || !s.token) throw new ApiError(0, "not_configured", "Set the API URL and token in options");
  let res: Response;
  try {
    res = await fetch(s.apiBase.replace(/\/+$/, "") + path, {
      method,
      headers: { Authorization: `Bearer ${s.token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network", "Cannot reach the server");
  }
  if (res.status === 204) return undefined as T;
  let data: { error?: { code?: string; message?: string } } | null = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "http_error", data?.error?.message ?? `HTTP ${res.status}`);
  return data as T;
}

export const ingest = (b: CaptureBatch) => call<{ added: number; merged: number; skipped: number }>("POST", "/api/ingest", b);
export const extPeople = () => call<Person[]>("GET", "/api/ext/people");
export const extLink = (person_id: number, platform: Platform, chat_key: string) =>
  call<void>("POST", "/api/ext/link", { person_id, platform, chat_key });
export const extUnlink = (platform: Platform, chat_key: string) => call<void>("DELETE", "/api/ext/link", { platform, chat_key });
export const extSummary = (platform: Platform, chat_key: string) =>
  call<ExtSummary>("GET", `/api/ext/summary?platform=${encodeURIComponent(platform)}&chat_key=${encodeURIComponent(chat_key)}`);
