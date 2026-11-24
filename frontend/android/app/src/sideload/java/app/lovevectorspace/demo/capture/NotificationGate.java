package app.lovevectorspace.demo.capture;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns a notification's (title, text) into (chat title, message text), or null for
 * summaries and content-hidden placeholders that are not real messages. Pure Java.
 */
public final class NotificationGate {

    private NotificationGate() {}

    public static final class Msg {
        public final String title;
        public final String text;

        Msg(String title, String text) {
            this.title = title;
            this.text = text;
        }
    }

    private static final Pattern SUMMARY = Pattern.compile(
        "^(\\d+ new messages?|\\d+ messages? from \\d+ chats?|\\d+ new notifications?)$",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern COUNT_SUFFIX = Pattern.compile("\\s*\\(\\d+ (new )?messages?\\)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern SENDER_PREFIX = Pattern.compile("^(.{1,60}?):\\s+(.+)$", Pattern.DOTALL);
    private static final Set<String> PLACEHOLDERS = new HashSet<>(
        Arrays.asList(
            "new message", "you have a new message", "sent you a message", "sent you a new message",
            "message", "checking for new messages", "photo", "video", "sticker", "gif", "voice message", "audio"
        )
    );

    public static Msg normalize(String slug, String title, String text) {
        if (text == null) return null;
        String t = text.trim();
        String ti = title == null ? "" : title.trim();
        if (t.isEmpty() || SUMMARY.matcher(t).matches()) return null;
        ti = COUNT_SUFFIX.matcher(ti).replaceFirst("");
        // Apps that hide the sender in the title put it in the text: "Sam: hey".
        String label = CaptureApps.label(slug).toLowerCase(Locale.ROOT);
        String tl = ti.toLowerCase(Locale.ROOT);
        if (ti.isEmpty() || tl.equals(label) || tl.equals("new message") || tl.equals("new match message")) {
            Matcher m = SENDER_PREFIX.matcher(t);
            if (!m.matches()) return null;
            ti = m.group(1).trim();
            t = m.group(2).trim();
        }
        if (ti.isEmpty() || t.isEmpty()) return null;
        if (PLACEHOLDERS.contains(t.toLowerCase(Locale.ROOT).replaceAll("[^a-z ]", "").trim())) return null;
        return new Msg(ti, t);
    }
}
