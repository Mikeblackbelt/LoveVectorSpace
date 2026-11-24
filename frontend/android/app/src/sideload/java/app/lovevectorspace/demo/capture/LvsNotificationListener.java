package app.lovevectorspace.demo.capture;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Notification reader (sideload only). Reads incoming message notifications from the
 * allowlisted apps and queues them ONLY when the chat matches a linked contact; every other
 * notification is dropped on the spot without being stored. Group conversations and the
 * user's own messages are skipped. Nothing is logged.
 */
public class LvsNotificationListener extends NotificationListenerService {

    @Override
    public void onListenerConnected() {
        CaptureIndicator.update(this);
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        String pkg = sbn.getPackageName();
        if (!CaptureApps.allowed(CaptureApps.NOTIFY, pkg)) return; // other apps: ignored entirely
        CaptureStore st = CaptureStore.get(this);
        if (!st.isActive(CaptureApps.NOTIFY)) return;
        ContactGate gate = st.gate();
        if (!gate.hasLinks(CaptureApps.NOTIFY)) return;
        Notification n = sbn.getNotification();
        if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        String slug = CaptureApps.slugFor(pkg);

        List<String[]> raw = new ArrayList<>(); // {title, text, timestampMs}
        NotificationCompat.MessagingStyle ms = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n);
        if (ms != null) {
            if (ms.isGroupConversation()) return;
            CharSequence conv = ms.getConversationTitle();
            CharSequence self = ms.getUser() == null ? null : ms.getUser().getName();
            for (NotificationCompat.MessagingStyle.Message m : ms.getMessages()) {
                Person p = m.getPerson();
                if (p == null || p.getName() == null) continue; // the user's own message
                if (self != null && self.toString().contentEquals(p.getName())) continue;
                CharSequence text = m.getText();
                if (text == null) continue;
                String title = conv != null ? conv.toString() : p.getName().toString();
                raw.add(new String[] { title, text.toString(), String.valueOf(m.getTimestamp() > 0 ? m.getTimestamp() : sbn.getPostTime()) });
            }
        } else {
            Bundle ex = n.extras;
            if (ex == null) return;
            CharSequence title = ex.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = ex.getCharSequence(Notification.EXTRA_BIG_TEXT);
            if (text == null) text = ex.getCharSequence(Notification.EXTRA_TEXT);
            if (text == null) return;
            // `when` survives notification updates, so a re-post of the same message dedupes.
            long when = n.when > 0 ? n.when : sbn.getPostTime();
            raw.add(new String[] { title == null ? "" : title.toString(), text.toString(), String.valueOf(when) });
        }

        List<CaptureQueue.Item> items = new ArrayList<>();
        List<String> keys = new ArrayList<>();
        String tz = TimeZone.getDefault().getID();
        for (String[] r : raw) {
            NotificationGate.Msg msg = NotificationGate.normalize(slug, r[0], r[1]);
            if (msg == null) continue;
            ContactGate.Link link = gate.match(CaptureApps.NOTIFY, pkg, msg.title);
            if (link == null) continue; // unlinked: never stored
            long ts = Long.parseLong(r[2]);
            CaptureQueue.Item it = CaptureStore.newItem(link, CaptureApps.source(CaptureApps.NOTIFY, slug), tz, "them", msg.text);
            it.tsUtc = isoUtc(ts);
            it.precision = ms != null ? "second" : "minute";
            items.add(it);
            // Re-posted notifications repeat earlier messages; the same text at the same time is one message.
            keys.add("them|" + ContactGate.normName(msg.text) + "|" + (ts / 1000L));
        }
        if (!items.isEmpty() && st.addAll(items, keys) > 0) CaptureIndicator.update(this);
    }

    static String isoUtc(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(ms));
    }
}
