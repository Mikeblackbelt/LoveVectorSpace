package app.lovevectorspace.demo.capture;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * The only gate between other apps' data and our queue: a message is kept only if its chat
 * matches a contact the user linked to a person, for that reader and that app. Pure Java.
 *
 * Names match exactly after normalisation (case, whitespace, invisible marks), never by
 * substring, so linking "Sam" does not capture "Samantha".
 */
public final class ContactGate {

    /** A linked contact. contact = chat title (notify/a11y) or phone number (sms). */
    public static final class Link {
        public final String method;
        public final String app;
        public final String contact;
        public final long pid;

        public Link(String method, String app, String contact, long pid) {
            this.method = method;
            this.app = app;
            this.contact = contact;
            this.pid = pid;
        }
    }

    private final List<Link> links;

    public ContactGate(List<Link> links) {
        this.links = links == null ? Collections.<Link>emptyList() : new ArrayList<>(links);
    }

    /** Lowercase, collapse whitespace, drop zero-width/bidi marks apps wrap names in. */
    public static String normName(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if ((c >= 0x200B && c <= 0x200F) || (c >= 0x202A && c <= 0x202E) || (c >= 0x2066 && c <= 0x2069) || c == 0xFEFF) continue;
            b.append(Character.isWhitespace(c) || c == 0x00A0 ? ' ' : c);
        }
        return b.toString().trim().replaceAll(" +", " ").toLowerCase(Locale.ROOT);
    }

    public static String digits(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c >= '0' && c <= '9') b.append(c);
        }
        return b.toString();
    }

    /**
     * Same phone number? Compares the last 10 digits (or all, if shorter), so "+1 555 010 2030"
     * matches "(555) 010-2030". Short codes and anything under 7 digits never match.
     */
    public static boolean phoneMatches(String a, String b) {
        String x = digits(a), y = digits(b);
        if (x.length() < 7 || y.length() < 7) return false;
        int n = Math.min(10, Math.min(x.length(), y.length()));
        return x.substring(x.length() - n).equals(y.substring(y.length() - n));
    }

    /** Linked contact for a chat title in an allowlisted app, or null (= ignore, store nothing). */
    public Link match(String method, String pkg, String title) {
        if (!CaptureApps.allowed(method, pkg)) return null;
        String slug = CaptureApps.slugFor(pkg);
        String t = normName(title);
        if (t.isEmpty()) return null;
        for (Link l : links) {
            if (l.method.equals(method) && l.app.equals(slug) && normName(l.contact).equals(t)) return l;
        }
        return null;
    }

    /** Linked SMS contact for a phone number, or null. */
    public Link matchPhone(String address) {
        for (Link l : links) {
            if (CaptureApps.SMS.equals(l.method) && phoneMatches(l.contact, address)) return l;
        }
        return null;
    }

    public List<Link> linksFor(String method) {
        List<Link> out = new ArrayList<>();
        for (Link l : links) if (l.method.equals(method)) out.add(l);
        return out;
    }

    public boolean hasLinks(String method) {
        for (Link l : links) if (l.method.equals(method)) return true;
        return false;
    }
}
