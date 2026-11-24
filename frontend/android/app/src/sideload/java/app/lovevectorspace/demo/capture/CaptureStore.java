package app.lovevectorspace.demo.capture;

import android.content.Context;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Process-wide capture state, persisted as one AES-GCM encrypted file in noBackupFilesDir:
 * linked contacts, per-reader switches, pause state, SMS cursors, the message queue and the
 * hashed seen-set. Shared by the plugin, the services and the pause receiver. Message text is
 * never logged.
 */
public final class CaptureStore {

    public static final long IDLE_PAUSE_MS = 30L * 60L * 1000L;
    private static CaptureStore instance;

    public static synchronized CaptureStore get(Context ctx) {
        if (instance == null) instance = new CaptureStore(ctx.getApplicationContext());
        return instance;
    }

    private final Context ctx;
    private final File file;
    private List<ContactGate.Link> links = new ArrayList<>();
    private final Map<String, Boolean> enabled = new HashMap<>();
    private boolean paused;
    private boolean a11yIdle;
    private long lastLinkedSeen;
    private long lastSavedAt;
    private final Map<String, Long> smsCursors = new HashMap<>();
    private final CaptureQueue queue = new CaptureQueue();

    private CaptureStore(Context ctx) {
        this.ctx = ctx;
        this.file = new File(ctx.getNoBackupFilesDir(), "lvs_capture.bin");
        load();
    }

    // ---------------------------------------------------------------- state

    public synchronized List<ContactGate.Link> links() {
        return new ArrayList<>(links);
    }

    public synchronized void setLinks(List<ContactGate.Link> next) {
        // Anything queued for a contact that is no longer linked is dropped right away.
        List<ContactGate.Link> old = links;
        links = new ArrayList<>(next);
        ContactGate g = new ContactGate(links);
        for (ContactGate.Link l : old) {
            boolean still = CaptureApps.SMS.equals(l.method) ? g.matchPhone(l.contact) != null : containsName(l);
            if (!still) queue.removeContact(l.method, l.app, l.contact);
        }
        save();
    }

    private boolean containsName(ContactGate.Link l) {
        for (ContactGate.Link x : links) {
            if (x.method.equals(l.method) && x.app.equals(l.app) && ContactGate.normName(x.contact).equals(ContactGate.normName(l.contact))) return true;
        }
        return false;
    }

    public synchronized ContactGate gate() {
        return new ContactGate(links);
    }

    public synchronized boolean isEnabled(String method) {
        Boolean b = enabled.get(method);
        return b != null && b;
    }

    public synchronized void setEnabled(String method, boolean on) {
        enabled.put(method, on);
        if (CaptureApps.A11Y.equals(method) && on) {
            a11yIdle = false;
            lastLinkedSeen = System.currentTimeMillis();
        }
        save();
    }

    public synchronized boolean isPaused() {
        return paused;
    }

    public synchronized boolean isA11yIdle() {
        return a11yIdle;
    }

    /** User pause/resume. Resuming also lifts the accessibility idle pause and restarts its timer. */
    public synchronized void setPaused(boolean p) {
        paused = p;
        if (!p) {
            a11yIdle = false;
            lastLinkedSeen = System.currentTimeMillis();
        }
        save();
    }

    /** May this reader capture right now? */
    public synchronized boolean isActive(String method) {
        if (!isEnabled(method) || paused) return false;
        return !(CaptureApps.A11Y.equals(method) && a11yIdle);
    }

    public synchronized void markLinkedSeen(long now) {
        lastLinkedSeen = now;
        if (now - lastSavedAt > 60_000) save(); // keep the timer roughly durable without writing per event
    }

    /** Auto-pause the accessibility reader after 30 minutes without a linked chat. True if it just paused. */
    public synchronized boolean checkIdle(long now) {
        if (!isEnabled(CaptureApps.A11Y) || paused || a11yIdle) return false;
        if (lastLinkedSeen == 0) lastLinkedSeen = now;
        if (now - lastLinkedSeen < IDLE_PAUSE_MS) return false;
        a11yIdle = true;
        save();
        return true;
    }

    public synchronized long smsCursor(String contact) {
        Long v = smsCursors.get(ContactGate.digits(contact));
        return v == null ? 0L : v;
    }

    public synchronized void setSmsCursor(String contact, long ms) {
        smsCursors.put(ContactGate.digits(contact), ms);
        save();
    }

    // ---------------------------------------------------------------- queue

    public static CaptureQueue.Item newItem(ContactGate.Link link, String source, String tz, String role, String text) {
        CaptureQueue.Item it = new CaptureQueue.Item();
        it.id = UUID.randomUUID().toString();
        it.method = link.method;
        it.app = link.app;
        it.contact = link.contact;
        it.pid = link.pid;
        it.source = source;
        it.tz = tz;
        it.role = role;
        it.text = text;
        return it;
    }

    /** Queue new items (skipping already-seen keys). keys.get(i) is the dedupe key for items.get(i). */
    public synchronized int addAll(List<CaptureQueue.Item> items, List<String> keys) {
        int n = 0;
        for (int i = 0; i < items.size(); i++) if (queue.addIfNew(items.get(i), keys.get(i))) n++;
        if (n > 0) save();
        return n;
    }

    public synchronized List<CaptureQueue.Item> drain(int max) {
        return queue.drain(max);
    }

    public synchronized int ack(Collection<String> ids) {
        int n = queue.ack(ids);
        if (n > 0) save();
        return n;
    }

    public synchronized int removeContact(String method, String app, String contact) {
        int n = queue.removeContact(method, app, contact);
        save();
        return n;
    }

    public synchronized int queued() {
        return queue.size();
    }

    // ---------------------------------------------------------------- persistence

    private void load() {
        if (!file.exists()) return;
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] blob = new byte[(int) file.length()];
            int off = 0;
            while (off < blob.length) {
                int r = in.read(blob, off, blob.length - off);
                if (r < 0) break;
                off += r;
            }
            JSONObject o = new JSONObject(new String(CryptoBox.decrypt(blob), StandardCharsets.UTF_8));
            links = linksFromJson(o.optJSONArray("links"));
            JSONObject en = o.optJSONObject("enabled");
            if (en != null) {
                Iterator<String> k = en.keys();
                while (k.hasNext()) {
                    String m = k.next();
                    enabled.put(m, en.optBoolean(m));
                }
            }
            paused = o.optBoolean("paused");
            a11yIdle = o.optBoolean("a11yIdle");
            lastLinkedSeen = o.optLong("lastLinkedSeen");
            JSONObject sc = o.optJSONObject("smsCursors");
            if (sc != null) {
                Iterator<String> k = sc.keys();
                while (k.hasNext()) {
                    String c = k.next();
                    smsCursors.put(c, sc.optLong(c));
                }
            }
            List<CaptureQueue.Item> items = new ArrayList<>();
            JSONArray q = o.optJSONArray("queue");
            for (int i = 0; q != null && i < q.length(); i++) items.add(itemFromJson(q.getJSONObject(i)));
            Map<String, String> seen = new LinkedHashMap<>();
            JSONObject s = o.optJSONObject("seen");
            if (s != null) {
                Iterator<String> k = s.keys();
                while (k.hasNext()) {
                    String key = k.next();
                    seen.put(key, s.optString(key));
                }
            }
            queue.restore(items, seen);
        } catch (Exception e) {
            // Unreadable (key lost after a restore/reset, or corrupt): start clean rather than crash.
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private void save() {
        lastSavedAt = System.currentTimeMillis();
        try {
            JSONObject o = new JSONObject();
            o.put("v", 1);
            o.put("links", linksToJson(links));
            JSONObject en = new JSONObject();
            for (Map.Entry<String, Boolean> e : enabled.entrySet()) en.put(e.getKey(), e.getValue());
            o.put("enabled", en);
            o.put("paused", paused);
            o.put("a11yIdle", a11yIdle);
            o.put("lastLinkedSeen", lastLinkedSeen);
            JSONObject sc = new JSONObject();
            for (Map.Entry<String, Long> e : smsCursors.entrySet()) sc.put(e.getKey(), e.getValue());
            o.put("smsCursors", sc);
            JSONArray q = new JSONArray();
            for (CaptureQueue.Item it : queue.all()) q.put(itemToJson(it, true));
            o.put("queue", q);
            JSONObject s = new JSONObject();
            for (Map.Entry<String, String> e : queue.seenEntries().entrySet()) s.put(e.getKey(), e.getValue());
            o.put("seen", s);
            byte[] blob = CryptoBox.encrypt(o.toString().getBytes(StandardCharsets.UTF_8));
            File tmp = new File(file.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(blob);
                out.getFD().sync();
            }
            if (!tmp.renameTo(file)) throw new IOException("rename failed");
        } catch (Exception e) {
            android.util.Log.w("LvsCapture", "could not save capture state: " + e.getClass().getSimpleName());
        }
    }

    // ---------------------------------------------------------------- JSON helpers (also used by the plugin)

    static List<ContactGate.Link> linksFromJson(JSONArray a) throws JSONException {
        List<ContactGate.Link> out = new ArrayList<>();
        for (int i = 0; a != null && i < a.length(); i++) {
            JSONObject l = a.getJSONObject(i);
            String method = l.getString("method");
            if (!CaptureApps.NOTIFY.equals(method) && !CaptureApps.SMS.equals(method) && !CaptureApps.A11Y.equals(method)) continue;
            String contact = l.getString("contact").trim();
            if (contact.isEmpty()) continue;
            out.add(new ContactGate.Link(method, l.getString("app"), contact, l.getLong("pid")));
        }
        return out;
    }

    static JSONArray linksToJson(List<ContactGate.Link> links) throws JSONException {
        JSONArray a = new JSONArray();
        for (ContactGate.Link l : links) {
            JSONObject o = new JSONObject();
            o.put("method", l.method);
            o.put("app", l.app);
            o.put("contact", l.contact);
            o.put("pid", l.pid);
            a.put(o);
        }
        return a;
    }

    /** internal=true keeps method/app/contact (for persistence); the JS drain view omits them. */
    static JSONObject itemToJson(CaptureQueue.Item it, boolean internal) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("id", it.id);
        o.put("pid", it.pid);
        o.put("source", it.source);
        o.put("tz", it.tz);
        o.put("role", it.role);
        o.put("text", it.text);
        if (it.tsUtc != null) o.put("ts_utc", it.tsUtc);
        if (it.tsLocal != null) o.put("ts_local", it.tsLocal);
        o.put("ts_precision", it.precision);
        if (internal) {
            o.put("method", it.method);
            o.put("app", it.app);
            o.put("contact", it.contact);
        }
        return o;
    }

    static CaptureQueue.Item itemFromJson(JSONObject o) throws JSONException {
        CaptureQueue.Item it = new CaptureQueue.Item();
        it.id = o.getString("id");
        it.pid = o.getLong("pid");
        it.source = o.getString("source");
        it.tz = o.getString("tz");
        it.role = o.getString("role");
        it.text = o.getString("text");
        it.tsUtc = o.has("ts_utc") ? o.getString("ts_utc") : null;
        it.tsLocal = o.has("ts_local") ? o.getString("ts_local") : null;
        it.precision = o.optString("ts_precision", "approx");
        it.method = o.optString("method");
        it.app = o.optString("app");
        it.contact = o.optString("contact");
        return it;
    }
}
