package app.lovevectorspace.demo.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import org.junit.Test;

public class CaptureGateTest {

    private final ContactGate gate = new ContactGate(
        Arrays.asList(
            new ContactGate.Link("notify", "tinder", "Sam", 2),
            new ContactGate.Link("a11y", "hinge", "Alex Kim", 3),
            new ContactGate.Link("sms", "sms", "+1 (555) 010-2030", 4)
        )
    );

    @Test
    public void allowlistCoversOnlyTheListedApps() {
        assertTrue(CaptureApps.allowed("notify", "com.whatsapp"));
        assertTrue(CaptureApps.allowed("notify", "com.whatsapp.w4b"));
        assertFalse("Hinge is accessibility-only", CaptureApps.allowed("notify", "co.hinge.app"));
        assertTrue(CaptureApps.allowed("a11y", "co.hinge.app"));
        assertTrue(CaptureApps.allowed("a11y", "com.google.android.apps.messaging"));
        assertFalse(CaptureApps.allowed("a11y", "com.android.chrome"));
        assertFalse(CaptureApps.allowed("notify", null));
        assertEquals("android_a11y_google_messages", CaptureApps.source("a11y", "google_messages"));
        assertEquals("android_sms", CaptureApps.source("sms", "sms"));
    }

    @Test
    public void matchesLinkedContactsExactlyNeverBySubstring() {
        assertEquals(2, gate.match("notify", "com.tinder", "Sam").pid);
        assertEquals(2, gate.match("notify", "com.tinder", "  sam ").pid);
        assertNull("substring must not match", gate.match("notify", "com.tinder", "Samantha"));
        assertNull("unlinked contact", gate.match("notify", "com.tinder", "Jordan"));
        assertNull("linked in another app only", gate.match("notify", "com.whatsapp", "Sam"));
        assertNull("linked for another reader only", gate.match("a11y", "com.tinder", "Sam"));
        assertNull("app outside the allowlist", gate.match("notify", "com.example.chat", "Sam"));
        assertNull(gate.match("notify", "com.tinder", null));
    }

    @Test
    public void ignoresInvisibleMarksAroundNames() {
        String wrapped = (char) 0x2068 + "Alex" + (char) 0x00A0 + "Kim" + (char) 0x2069;
        assertNotNull(gate.match("a11y", "co.hinge.app", wrapped));
    }

    @Test
    public void phoneNumbersMatchOnTrailingDigits() {
        assertEquals(4, gate.matchPhone("5550102030").pid);
        assertEquals(4, gate.matchPhone("+15550102030").pid);
        assertNull(gate.matchPhone("+15550102031"));
        assertFalse("short codes never match", ContactGate.phoneMatches("12345", "12345"));
        assertTrue(ContactGate.phoneMatches("+44 7700 900123", "07700900123"));
    }

    @Test
    public void notificationGateSkipsSummariesAndPlaceholders() {
        assertNull(NotificationGate.normalize("whatsapp", "WhatsApp", "3 new messages"));
        assertNull(NotificationGate.normalize("whatsapp", "Sam", "5 messages from 2 chats"));
        assertNull(NotificationGate.normalize("tinder", "Tinder", "You have a new message"));
        assertNull(NotificationGate.normalize("instagram", "sam_r", "📷 Photo"));
        assertNull(NotificationGate.normalize("discord", "Sam", "   "));
    }

    @Test
    public void notificationGateRecoversSenderFromTextAndStripsCounts() {
        NotificationGate.Msg m = NotificationGate.normalize("tinder", "Tinder", "Sam: are you free friday?");
        assertEquals("Sam", m.title);
        assertEquals("are you free friday?", m.text);
        m = NotificationGate.normalize("whatsapp", "Sam (2 messages)", "hello");
        assertEquals("Sam", m.title);
        m = NotificationGate.normalize("whatsapp", "Sam", "note: bring snacks");
        assertEquals("Sam", m.title);
        assertEquals("a colon in the text is kept when the title names the sender", "note: bring snacks", m.text);
    }
}
