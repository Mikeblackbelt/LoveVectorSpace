import * as api from "./api";
import type { BgRequest, BgResponse } from "./messages";
import { BATCH_MAX, Queue } from "./queue";

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
      case "import": {
        // One-shot import: sent directly (not via the live queue), in batches of <= 200 sharing one unit_id.
        let sent = 0;
        for (let i = 0; i < req.msgs.length; i += BATCH_MAX) {
          await api.ingest({ platform: req.platform, chat_key: req.chat_key, tz: req.tz, unit_id: req.unit_id, messages: req.msgs.slice(i, i + BATCH_MAX) });
          sent += Math.min(BATCH_MAX, req.msgs.length - i);
        }
        return { ok: true, sent };
      }
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
