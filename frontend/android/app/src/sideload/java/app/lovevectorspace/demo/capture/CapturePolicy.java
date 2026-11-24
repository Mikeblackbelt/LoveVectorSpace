package app.lovevectorspace.demo.capture;

/**
 * Native-side gating rules, independent of the JS UI. Pure Java (unit-tested); CaptureStore
 * feeds it its state.
 */
public final class CapturePolicy {

    private CapturePolicy() {}

    /** Bump when the consent explanation changes materially; the app then asks again. */
    public static final int CONSENT_VERSION = 1;

    public static final class State {
        public String owner; // signed-in account id, null when signed out
        public boolean consented; // native consent at CONSENT_VERSION for this reader
        public boolean enabled;
        public boolean paused;
        public boolean a11yIdle;
        public boolean notificationsOk; // the "capturing" indicator can be shown
    }

    /** May this reader capture right now? Needs a signed-in owner, consent, the switch, a visible indicator, no pause. */
    public static boolean isActive(String method, State s) {
        if (s.owner == null || !s.consented || !s.enabled || s.paused || !s.notificationsOk) return false;
        return !(CaptureApps.A11Y.equals(method) && s.a11yIdle);
    }

    /** Switching a reader ON requires a signed-in owner and native consent. Switching OFF is always allowed. */
    public static boolean canEnable(boolean on, String owner, int consentVersion) {
        return !on || (owner != null && consentVersion >= CONSENT_VERSION);
    }

    /** Linking contacts for a reader requires a signed-in owner and that reader's consent. */
    public static boolean canLink(String owner, int consentVersion) {
        return owner != null && consentVersion >= CONSENT_VERSION;
    }

    /** The queue is handed out only to the account that owns it. */
    public static boolean canDrain(String owner, String expectedUser) {
        return owner != null && expectedUser != null && owner.equals(expectedUser);
    }
}
