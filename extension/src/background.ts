import * as api from "./api";
import type { BgRequest, BgResponse } from "./messages";
import { Queue } from "./queue";

const queue = new Queue();

chrome.runtime.onInstalled.addListener(() => void chrome.alarms.create("flush", { periodInMinutes: 0.5 }));
chrome.runtime.onStartup.addListener(() => void chrome.alarms.create("flush", { periodInMinutes: 0.5 }));
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "flush") void queue.flush(api.ingest);
});

async function handle(req: BgRequest): Promise<BgResponse> {
  try {
    switch (req.type) {
      case "enqueue":
        return { ok: true, accepted: await queue.enqueue(req.platform, req.chat_key, req.tz, req.msgs) };
      case "summary":
        return { ok: true, summary: await api.extSummary(req.platform, req.chat_key) };
      case "flush": {
        const r = await queue.flush(api.ingest, true);
        return r.error ? { ok: false, code: "flush_failed", error: r.error } : { ok: true, sent: r.sent };
      }
    }
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { ok: false, code: err.code ?? "error", error: err.message ?? "error" };
  }
}

chrome.runtime.onMessage.addListener((req: BgRequest, _sender, sendResponse) => {
  void handle(req).then(sendResponse);
  return true;
});
