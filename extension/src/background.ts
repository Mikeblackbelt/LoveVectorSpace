import * as api from "./api";
import type { BgRequest, BgResponse } from "./messages";
import { BATCH_MAX, Queue, clampText, postSplit } from "./queue";
import { forgetChats, getKey, getSettings, setKey } from "./storage";

const queue = new Queue();

chrome.runtime.onInstalled.addListener(() => void chrome.alarms.create("flush", { periodInMinutes: 0.5 }));
chrome.runtime.onStartup.addListener(() => void chrome.alarms.create("flush", { periodInMinutes: 0.5 }));
/** Flush, and forget local links for chats the server says are no longer linked. */
async function flush(force: boolean) {
  const r = await queue.flush(api.ingest, force);
  if (r.dropped_unlinked?.length) await forgetChats(r.dropped_unlinked);
  return r;
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "flush") void flush(false);
});

async function handle(req: BgRequest): Promise<BgResponse> {
  try {
    switch (req.type) {
      case "enqueue":
        return { ok: true, accepted: await queue.enqueue(req.platform, req.chat_key, req.tz, req.msgs, { direction_uncertain: req.direction_uncertain }) };
      case "config":
        return { ok: true, waDateFormat: (await getSettings()).waDateFormat };
      case "summary":
        return { ok: true, summary: await api.extSummary(req.platform, req.chat_key) };
      case "import": {
        // One-shot import: sent directly (not via the live queue), in batches of <= 200 sharing one unit_id.
        const msgs = req.msgs.map((m) => ({ ...m, text: clampText(m.text) }));
        const { sent, rejected } = await postSplit(msgs, BATCH_MAX, (chunk) =>
          api.ingest({ platform: req.platform, chat_key: req.chat_key, tz: req.tz, unit_id: req.unit_id, ...(req.direction_uncertain ? { direction_uncertain: true } : {}), messages: chunk }),
        );
        if (rejected) await setKey("rejected_count", (await getKey<number>("rejected_count", 0)) + rejected);
        return { ok: true, sent };
      }
      case "flush": {
        const r = await flush(true);
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
