package app.lovevectorspace.demo.capture;

import android.content.Context;
import android.telephony.PhoneNumberUtils;
import android.telephony.TelephonyManager;
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
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Process-wide capture state, persisted as one AES-GCM encrypted file in noBackupFilesDir:
 * owner account, native consent per reader, linked contacts, switches, pause state, SMS cursors,
 * the queue and the hashed seen-set. Gating decisions go through CapturePolicy. Message text is
 * never logged.
 */
public final class CaptureStore {

    public static final long IDLE_PAUSE_MS = 30L * 60L * 1000L;
    private static final String[] READERS = { CaptureApps.NOTIFY, CaptureApps.SMS, CaptureApps.A11Y };
    private static CaptureStore instance;

    public static synchronized CaptureStore get(Context ctx) {
        if (instance == null) instance = new CaptureStore(ctx.getApplicationContext());
        return instance;
    }

    private final Context ctx;
    private final File file;
    private String owner; // signed-in account; null = signed out, nothing runs
    private final Map<String, Integer> consent = new HashMap<>();
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

    // ---------------------------------------------------------------- owner / sign-in

    public synchronized String owner() {
        return owner;
    }

    /**
     * Bind capture to the signed-in account. A different account wipes everything first; the new
     * owner is written only after the wipe is durable. Returns "bound", "same" or "reset".
     */
    public synchronized String bindOwner(String userId) {
        if (userId == null || userId.isEmpty()) throw new IllegalArgumentException("userId");
        if (userId.equals(owner)) return "same";
        boolean hadOther = owner != null;
        if (hadOther || !links.isEmpty() || queue.size() > 0) {
            wipe();
            if (!save()) {
                //noinspection ResultOfMethodCallIgnored
                file.delete(); // the wipe must stick before anyone new owns the state
                if (file.exists()) return "error";
            }
        }
        owner = userId;
        save();
        return hadOther ? "reset" : "bound";
    }

    /** Sign-out / account deletion: forget everything, including the owner. */
    public synchronized void clearAll() {
        wipe();
        if (!save()) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private void wipe() {
        owner = null;
        consent.clear();
        links = new ArrayList<>();
        enabled.clear();
        paused = false;
        a11yIdle = false;
        lastLinkedSeen = 0;
        smsCursors.clear();
        queue.clear();
    }

    // ---------------------------------------------------------------- consent

    public synchronized int consentVersion(String method) {
        Integer v = consent.get(method);
        return v == null ? 0 : v;
    }

    /** Record agreement (version) or withdrawal (0). Withdrawing switches the reader off and unlinks its contacts. */
    public synchronized boolean setConsent(String method, int version) {
        if (owner == null && version > 0) return false;
        if (version <= 0) {
            consent.remove(method);
            enabled.put(method, false);
            List<ContactGate.Link> keep = new ArrayList<>();
            for (ContactGate.Link l : links) if (l.method.equals(method)) forget(l); else keep.add(l);
            links = keep;
        } else {
            consent.put(method, version);
        }
        save();
        return true;
    }

    // ---------------------------------------------------------------- links

    public synchronized List<ContactGate.Link> links() {
        return new ArrayList<>(links);
    }

    PhoneMatcher phoneMatcher() {
        final String iso = countryIso();
        return new PhoneMatcher(raw -> {
            String e = null;
            try {
                e = PhoneNumberUtils.formatNumberToE164(raw, iso);
            } catch (RuntimeException ignored) {
                // fall through to the simple normaliser
            }
            return e != null ? e : PhoneMatcher.simpleE164(raw, null);
        });
    }

    private String countryIso() {
        TelephonyManager tm = (TelephonyManager) ctx.getSystemService(Context.TELEPHONY_SERVICE);
        String iso = null;
        if (tm != null) {
            iso = tm.getSimCountryIso();
            if (iso == null || iso.isEmpty()) iso = tm.getNetworkCountryIso();
        }
        if (iso == null || iso.isEmpty()) iso = Locale.getDefault().getCountry();
        return iso == null ? "" : iso.toUpperCase(Locale.ROOT);
    }

    /**
     * Replace the linked contacts. Links for readers without native consent, and SMS links that
     * can't be normalised, are rejected (returned). Contacts that are no longer linked lose their
     * queued messages, seen-hashes and SMS cursor immediately.
     */
    public synchronized List<ContactGate.Link> setLinks(List<ContactGate.Link> next) {
        List<ContactGate.Link> accepted = new ArrayList<>();
        List<ContactGate.Link> rejected = new ArrayList<>();
        PhoneMatcher pm = phoneMatcher();
        for (ContactGate.Link l : next) {
            if (!CapturePolicy.canLink(owner, consentVersion(l.method))) {
                rejected.add(l);
                continue;
            }
            if (CaptureApps.SMS.equals(l.method)) {
                String c = pm.canonical(l.contact);
                if (c == null) {
                    rejected.add(l);
                    continue;
                }
                accepted.add(new ContactGate.Link(l.method, "sms", c, l.pid));
            } else {
                accepted.add(l);
            }
        }
        for (ContactGate.Link old : links) if (!contains(accepted, old)) forget(old);
        links = accepted;
        save();
        return rejected;
    }

    private static boolean contains(List<ContactGate.Link> ls, ContactGate.Link l) {
        for (ContactGate.Link x : ls) {
            if (x.method.equals(l.method) && x.app.equals(l.app) && ContactGate.normName(x.contact).equals(ContactGate.normName(l.contact))) return true;
        }
        return false;
    }

    private void forget(ContactGate.Link l) {
        queue.removeContact(l.method, l.app, l.contact);
        if (CaptureApps.SMS.equals(l.method)) smsCursors.remove(l.contact);
    }

    public synchronized ContactGate gate() {
        return new ContactGate(links);
    }

    // ---------------------------------------------------------------- switches

    public synchronized boolean isEnabled(String method) {
        Boolean b = enabled.get(method);
        return b != null && b;
    }

    /** False if refused (switching on needs a signed-in owner and native consent). */
    public synchronized boolean setEnabled(String method, boolean on) {
        if (!CapturePolicy.canEnable(on, owner, consentVersion(method))) return false;
        enabled.put(method, on);
        if (CaptureApps.A11Y.equals(method) && on) {
            a11yIdle = false;
            lastLinkedSeen = System.currentTimeMillis();
        }
        save();
        return true;
    }

    public synchronized boolean isPaused() {
        return paused;
    }

    public synchronized boolean isA11yIdle() {
        return a11yIdle;
    }

    public synchronized boolean anyEnabled() {
        for (String m : READERS) if (isEnabled(m)) return true;
        return false;
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

    private CapturePolicy.State policyState(String method) {
        CapturePolicy.State s = new CapturePolicy.State();
        s.owner = owner;
        s.consented = consentVersion(method) >= CapturePolicy.CONSENT_VERSION;
        s.enabled = isEnabled(method);
        s.paused = paused;
        s.a11yIdle = a11yIdle;
        s.notificationsOk = CaptureIndicator.canPostNotifications(ctx);
        return s;
    }

    /** May this reader capture right now? (CapturePolicy.isActive) */
    public synchronized boolean isActive(String method) {
        return CapturePolicy.isActive(method, policyState(method));
    }

    public synchronized void markLinkedSeen(long now) {
        lastLinkedSeen = now;
        if (now - lastSavedAt > 60_000) save();
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

    public synchronized long smsCursor(String canonical) {
        Long v = smsCursors.get(canonical);
        return v == null ? 0L : v;
    }

    public synchronized void setSmsCursor(String canonical, long ms) {
        smsCursors.put(canonical, ms);
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

    /** Queue new items (skipping already-seen keys). Refused while signed out. */
    public synchronized int addAll(List<CaptureQueue.Item> items, List<String> keys) {
        if (owner == null) return 0;
        int n = 0;
        for (int i = 0; i < items.size(); i++) if (queue.addIfNew(items.get(i), keys.get(i))) n++;
        if (n > 0) save();
        return n;
    }

    /** Oldest items, only for the owning account; null if the caller isn't the owner. */
    public synchronized List<CaptureQueue.Item> drain(int max, String expectedUser) {
        if (!CapturePolicy.canDrain(owner, expectedUser)) return null;
        return queue.drain(max);
    }

    public synchronized int ack(Collection<String> ids) {
        int n = queue.ack(ids);
        if (n > 0) save();
        return n;
    }

    public synchronized int removeContact(String method, String app, String contact) {
        int n = queue.removeContact(method, app, contact);
        if (CaptureApps.SMS.equals(method)) {
            String c = phoneMatcher().canonical(contact);
            smsCursors.remove(c != null ? c : contact);
        }
        save();
        return n;
    }

    public synchronized int queued() {
        return queue.size();
    }

    public synchronized int droppedForCap() {
        return queue.dropped;
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
            owner = o.has("owner") ? o.getString("owner") : null;
            JSONObject cs = o.optJSONObject("consent");
            if (cs != null) {
                Iterator<String> k = cs.keys();
                while (k.hasNext()) {
                    String m = k.next();
                    consent.put(m, cs.optInt(m));
                }
            }
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
            queue.dropped = o.optInt("dropped");
        } catch (Exception e) {
            // Unreadable (key lost after a restore/reset, or corrupt): start clean, signed out.
            wipe();
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private boolean save() {
        lastSavedAt = System.currentTimeMillis();
        try {
            JSONObject o = new JSONObject();
            o.put("v", 2);
            if (owner != null) o.put("owner", owner);
            JSONObject cs = new JSONObject();
            for (Map.Entry<String, Integer> e : consent.entrySet()) cs.put(e.getKey(), e.getValue());
            o.put("consent", cs);
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
            o.put("dropped", queue.dropped);
            byte[] blob = CryptoBox.encrypt(o.toString().getBytes(StandardCharsets.UTF_8));
            File tmp = new File(file.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(blob);
                out.getFD().sync();
            }
            if (!tmp.renameTo(file)) throw new IOException("rename failed");
            return true;
        } catch (Exception e) {
            android.util.Log.w("LvsCapture", "could not save capture state: " + e.getClass().getSimpleName());
            return false;
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

    /** internal=true keeps method/app/contact (persistence); the JS view carries only the opaque contact key "ck". */
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
        } else {
            o.put("ck", it.contactKey());
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
