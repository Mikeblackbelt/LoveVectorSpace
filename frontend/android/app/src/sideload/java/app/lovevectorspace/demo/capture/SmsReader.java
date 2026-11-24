package app.lovevectorspace.demo.capture;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Telephony;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.TimeZone;

/**
 * SMS reader (sideload only). Reads both sides of SMS (and MMS text) threads with LINKED
 * phone numbers only, since the last sync, into the encrypted queue as source android_sms.
 * Queries are filtered by number in SQL and re-checked with ContactGate; group MMS threads
 * are skipped. Nothing is logged.
 */
final class SmsReader {

    /** First sync of a newly linked number looks back this far. */
    static final long FIRST_SYNC_WINDOW_MS = 180L * 24L * 3600L * 1000L;
    private static final int MMS_ADDR_FROM = 137;
    private static final int MMS_ADDR_TO = 151;

    private SmsReader() {}

    static int sync(Context ctx) {
        if (!CaptureIndicator.smsGranted(ctx)) return 0;
        CaptureStore st = CaptureStore.get(ctx);
        if (!st.isActive(CaptureApps.SMS)) return 0;
        ContentResolver cr = ctx.getContentResolver();
        String tz = TimeZone.getDefault().getID();
        int total = 0;
        for (ContactGate.Link link : st.gate().linksFor(CaptureApps.SMS)) {
            String digits = ContactGate.digits(link.contact);
            if (digits.length() < 7) continue;
            long since = st.smsCursor(link.contact);
            if (since == 0) since = System.currentTimeMillis() - FIRST_SYNC_WINDOW_MS;
            long max = since;
            List<CaptureQueue.Item> items = new ArrayList<>();
            List<String> keys = new ArrayList<>();
            Set<Long> threads = new LinkedHashSet<>();
            String tail = digits.substring(digits.length() - 7);

            String[] cols = { Telephony.Sms._ID, Telephony.Sms.THREAD_ID, Telephony.Sms.ADDRESS, Telephony.Sms.DATE, Telephony.Sms.TYPE, Telephony.Sms.BODY };
            try (Cursor c = cr.query(Telephony.Sms.CONTENT_URI, cols, Telephony.Sms.DATE + " > ? AND " + Telephony.Sms.ADDRESS + " LIKE ?",
                new String[] { String.valueOf(since), "%" + tail }, Telephony.Sms.DATE + " ASC")) {
                while (c != null && c.moveToNext()) {
                    String addr = c.getString(2);
                    if (!ContactGate.phoneMatches(addr, link.contact)) continue;
                    threads.add(c.getLong(1));
                    int type = c.getInt(4);
                    String role = type == Telephony.Sms.MESSAGE_TYPE_INBOX ? "them" : type == Telephony.Sms.MESSAGE_TYPE_SENT ? "me" : null;
                    String body = c.getString(5);
                    long date = c.getLong(3);
                    if (role == null || body == null || body.trim().isEmpty()) continue;
                    add(items, keys, link, tz, role, body, date, "sms" + c.getLong(0));
                    max = Math.max(max, date);
                }
            } catch (SecurityException e) {
                return total;
            }
            max = Math.max(max, readMms(cr, link, threads, since, tz, items, keys));
            total += st.addAll(items, keys);
            if (max > since) st.setSmsCursor(link.contact, max);
        }
        return total;
    }

    /** MMS text parts in the same (one-to-one) threads. Returns the newest date seen, in ms. */
    private static long readMms(ContentResolver cr, ContactGate.Link link, Set<Long> threads, long since, String tz,
        List<CaptureQueue.Item> items, List<String> keys) {
        long max = since;
        if (threads.isEmpty()) return max;
        StringBuilder in = new StringBuilder();
        for (Long t : threads) in.append(in.length() == 0 ? "" : ",").append(t);
        String sel = "thread_id IN (" + in + ") AND date > ?"; // ids are longs from the provider, not user input
        try (Cursor c = cr.query(Uri.parse("content://mms"), new String[] { "_id", "date", "msg_box" }, sel,
            new String[] { String.valueOf(since / 1000L) }, "date ASC")) {
            while (c != null && c.moveToNext()) {
                long id = c.getLong(0);
                long date = c.getLong(1) * 1000L; // MMS dates are seconds
                int box = c.getInt(2);
                String role = box == 1 ? "them" : box == 2 ? "me" : null;
                if (role == null || !oneToOneWith(cr, id, link)) continue;
                String text = mmsText(cr, id);
                if (text == null || text.trim().isEmpty()) continue;
                add(items, keys, link, tz, role, text, date, "mms" + id);
                max = Math.max(max, date);
            }
        } catch (SecurityException e) {
            return max;
        }
        return max;
    }

    private static boolean oneToOneWith(ContentResolver cr, long mmsId, ContactGate.Link link) {
        int others = 0;
        boolean match = false;
        try (Cursor c = cr.query(Uri.parse("content://mms/" + mmsId + "/addr"), new String[] { "address", "type" }, null, null, null)) {
            while (c != null && c.moveToNext()) {
                int type = c.getInt(1);
                if (type != MMS_ADDR_FROM && type != MMS_ADDR_TO) continue;
                String a = c.getString(0);
                if (a == null || a.equals("insert-address-token")) continue;
                if (ContactGate.phoneMatches(a, link.contact)) match = true;
                else others++;
            }
        }
        // FROM/TO include our own number once; more than one other party means a group thread.
        return match && others <= 1;
    }

    private static String mmsText(ContentResolver cr, long mmsId) {
        StringBuilder b = new StringBuilder();
        try (Cursor c = cr.query(Uri.parse("content://mms/part"), new String[] { "ct", "text" }, "mid = ?", new String[] { String.valueOf(mmsId) }, null)) {
            while (c != null && c.moveToNext()) {
                if (!"text/plain".equals(c.getString(0))) continue; // attachments are never read
                String t = c.getString(1);
                if (t != null) b.append(b.length() == 0 ? "" : "\n").append(t);
            }
        }
        return b.toString();
    }

    private static void add(List<CaptureQueue.Item> items, List<String> keys, ContactGate.Link link, String tz, String role, String text,
        long dateMs, String providerId) {
        CaptureQueue.Item it = CaptureStore.newItem(link, "android_sms", tz, role, text);
        it.tsUtc = LvsNotificationListener.isoUtc(dateMs);
        it.precision = "second";
        items.add(it);
        keys.add(providerId);
    }
}
