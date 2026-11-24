package app.lovevectorspace.demo.capture;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * In-memory capture queue plus the "already seen" set used to avoid re-queuing the same
 * message (notifications are re-posted, accessibility events repeat on every scroll).
 * Pure Java; CaptureStore persists it encrypted. Not thread-safe: CaptureStore synchronises.
 */
public final class CaptureQueue {

    public static final int MAX_ITEMS = 5000;
    public static final int MAX_SEEN = 20000;

    public static final class Item {
        public String id;
        public String method;
        public String app;
        public String contact;
        public long pid;
        public String source;
        public String tz;
        public String role;
        public String text;
        public String tsUtc; // or null
        public String tsLocal; // or null
        public String precision;

        /** Key for the seen-set: method|app|contact|content key. Hashed before storing. */
        public String contactKey() {
            return method + "|" + app + "|" + ContactGate.normName(contact);
        }
    }

    private final List<Item> items = new ArrayList<>();
    /** Messages dropped because the queue was full (surfaced as a warning in status). */
    public int dropped;
    /** contactKey -> set of message keys; insertion-ordered for eviction. */
    private final LinkedHashMap<String, String> seen = new LinkedHashMap<>(16, 0.75f, false);

    public int size() {
        return items.size();
    }

    public List<Item> all() {
        return new ArrayList<>(items);
    }

    /** True if added, false if this message key was already seen for the contact. */
    public boolean addIfNew(Item it, String messageKey) {
        // Only a hash of the message key is remembered, never its text.
        String k = it.contactKey() + "#" + sha256(messageKey);
        if (seen.containsKey(k)) return false;
        seen.put(k, it.contactKey());
        while (seen.size() > MAX_SEEN) {
            Iterator<String> i = seen.keySet().iterator();
            i.next();
            i.remove();
        }
        items.add(it);
        while (items.size() > MAX_ITEMS) {
            items.remove(0); // oldest first
            dropped++;
        }
        return true;
    }

    public List<Item> drain(int max) {
        return new ArrayList<>(items.subList(0, Math.min(Math.max(0, max), items.size())));
    }

    public int ack(Collection<String> ids) {
        Set<String> s = new HashSet<>(ids);
        int before = items.size();
        items.removeIf(x -> s.contains(x.id));
        return before - items.size();
    }

    /** Forget everything queued or seen for one contact. Returns queued items removed. */
    public int removeContact(String method, String app, String contact) {
        Item probe = new Item();
        probe.method = method;
        probe.app = app;
        probe.contact = contact;
        String ck = probe.contactKey();
        int before = items.size();
        items.removeIf(x -> x.contactKey().equals(ck));
        seen.values().removeIf(v -> v.equals(ck));
        return before - items.size();
    }

    static String sha256(String s) {
        try {
            byte[] d = java.security.MessageDigest.getInstance("SHA-256").digest(s.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < 16; i++) b.append(String.format(java.util.Locale.ROOT, "%02x", d[i]));
            return b.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public int seenSize() {
        return seen.size();
    }

    // ---- persistence hooks (CaptureStore) ----
    public Map<String, String> seenEntries() {
        return new LinkedHashMap<>(seen);
    }

    /** Forget everything (sign-out, account switch). */
    public void clear() {
        items.clear();
        seen.clear();
        dropped = 0;
    }

    public void restore(List<Item> its, Map<String, String> seenEntries) {
        items.clear();
        items.addAll(its);
        seen.clear();
        seen.putAll(seenEntries);
    }
}
