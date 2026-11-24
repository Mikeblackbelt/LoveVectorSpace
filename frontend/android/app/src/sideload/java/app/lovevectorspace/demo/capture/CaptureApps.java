package app.lovevectorspace.demo.capture;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Allowlisted apps per reader. Pure Java (unit-tested). Must stay in sync with
 * res/xml/lvs_accessibility_config.xml (packageNames) and src/features/capture/apps.ts.
 */
public final class CaptureApps {

    private CaptureApps() {}

    public static final String NOTIFY = "notify";
    public static final String SMS = "sms";
    public static final String A11Y = "a11y";

    /** Package name -> app slug used in sources (android_notify_<slug>, android_a11y_<slug>). */
    public static final Map<String, String> PACKAGE_TO_SLUG;

    static {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("com.whatsapp", "whatsapp");
        m.put("com.whatsapp.w4b", "whatsapp");
        m.put("com.instagram.android", "instagram");
        m.put("com.tinder", "tinder");
        m.put("co.hinge.app", "hinge");
        m.put("com.grindrapp.android", "grindr");
        m.put("com.bumble.app", "bumble");
        m.put("com.discord", "discord");
        m.put("com.google.android.apps.messaging", "google_messages");
        PACKAGE_TO_SLUG = Collections.unmodifiableMap(m);
    }

    public static final Set<String> NOTIFY_SLUGS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList("whatsapp", "instagram", "tinder", "grindr", "bumble", "discord"))
    );

    public static final Set<String> A11Y_SLUGS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList("whatsapp", "instagram", "tinder", "hinge", "grindr", "bumble", "discord", "google_messages"))
    );

    /** Slug for an allowlisted package, or null for every other app. */
    public static String slugFor(String pkg) {
        return pkg == null ? null : PACKAGE_TO_SLUG.get(pkg);
    }

    /** Is this package allowed for this reader? */
    public static boolean allowed(String method, String pkg) {
        String slug = slugFor(pkg);
        if (slug == null) return false;
        if (NOTIFY.equals(method)) return NOTIFY_SLUGS.contains(slug);
        if (A11Y.equals(method)) return A11Y_SLUGS.contains(slug);
        return false;
    }

    public static String source(String method, String slug) {
        if (SMS.equals(method)) return "android_sms";
        return "android_" + method + "_" + slug;
    }

    /** Display names the notification title may carry when the app hides the sender. */
    public static String label(String slug) {
        switch (slug) {
            case "whatsapp": return "WhatsApp";
            case "instagram": return "Instagram";
            case "tinder": return "Tinder";
            case "hinge": return "Hinge";
            case "grindr": return "Grindr";
            case "bumble": return "Bumble";
            case "discord": return "Discord";
            case "google_messages": return "Messages";
            default: return slug;
        }
    }
}
