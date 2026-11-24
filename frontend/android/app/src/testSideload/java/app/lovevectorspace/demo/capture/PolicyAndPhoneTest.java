package app.lovevectorspace.demo.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PolicyAndPhoneTest {

    private static CapturePolicy.State active() {
        CapturePolicy.State s = new CapturePolicy.State();
        s.owner = "user-a";
        s.consented = true;
        s.enabled = true;
        s.notificationsOk = true;
        return s;
    }

    @Test
    public void readersNeedOwnerConsentSwitchIndicatorAndNoPause() {
        assertTrue(CapturePolicy.isActive("notify", active()));
        CapturePolicy.State s = active();
        s.owner = null;
        assertFalse("signed out", CapturePolicy.isActive("notify", s));
        s = active();
        s.consented = false;
        assertFalse("no native consent", CapturePolicy.isActive("notify", s));
        s = active();
        s.notificationsOk = false;
        assertFalse("indicator can't be shown", CapturePolicy.isActive("sms", s));
        s = active();
        s.paused = true;
        assertFalse(CapturePolicy.isActive("a11y", s));
        s = active();
        s.a11yIdle = true;
        assertFalse(CapturePolicy.isActive("a11y", s));
        assertTrue("idle only pauses the chat reader", CapturePolicy.isActive("notify", s));
    }

    @Test
    public void enableLinkAndDrainGates() {
        assertTrue("turning off is always allowed", CapturePolicy.canEnable(false, null, 0));
        assertFalse(CapturePolicy.canEnable(true, "u", 0));
        assertFalse(CapturePolicy.canEnable(true, null, CapturePolicy.CONSENT_VERSION));
        assertTrue(CapturePolicy.canEnable(true, "u", CapturePolicy.CONSENT_VERSION));
        assertFalse(CapturePolicy.canLink("u", 0));
        assertTrue(CapturePolicy.canDrain("u", "u"));
        assertFalse(CapturePolicy.canDrain("u", "v"));
        assertFalse(CapturePolicy.canDrain(null, null));
    }

    // Fake platform normaliser: UK SIM.
    private final PhoneMatcher uk = new PhoneMatcher(raw -> PhoneMatcher.simpleE164(raw, "44"));

    @Test
    public void phoneLinksNormaliseToE164AndMatchFullNumbersOnly() {
        assertEquals("+447700900123", uk.canonical("07700 900123"));
        assertEquals("+447700900123", uk.canonical("+44 7700 900123"));
        assertEquals("+15550102030", uk.canonical("001 555 010 2030"));
        assertNull("too short", uk.canonical("12345"));
        assertTrue(uk.matches("+447700900123", "07700900123"));
        assertTrue(uk.matches("+447700900123", "+447700900123"));
        // Same last 10 digits, different country: no longer a match.
        assertFalse(uk.matches("+447700900123", "+337700900123"));
        assertFalse(uk.matches("+447700900123", "+447700900124"));
    }

    @Test
    public void alphanumericSendersMatchOnlyExactStrings() {
        assertEquals("Uber", uk.canonical(" Uber "));
        assertTrue(uk.matches("Uber", "UBER"));
        assertFalse(uk.matches("Uber", "Uber Eats"));
        assertFalse(uk.matches("+447700900123", "Uber"));
        assertNull("alphanumeric sender ids are at most 11 chars", uk.canonical("A very long sender"));
    }

    @Test
    public void simpleE164Fallback() {
        assertEquals("+15550102030", PhoneMatcher.simpleE164("(555) 010-2030", "1"));
        assertEquals("+15550102030", PhoneMatcher.simpleE164("1 555 010 2030", "1"));
        assertNull(PhoneMatcher.simpleE164("5550102030", null));
        assertEquals("0102030", PhoneMatcher.prefilterTail("+15550102030"));
    }
}
