package app.lovevectorspace.demo.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class CaptureQueueTest {

    private static int seq = 0;

    private static CaptureQueue.Item item(String contact, String text) {
        CaptureQueue.Item it = new CaptureQueue.Item();
        it.id = "i" + (++seq);
        it.method = "notify";
        it.app = "whatsapp";
        it.contact = contact;
        it.pid = 1;
        it.source = "android_notify_whatsapp";
        it.tz = "UTC";
        it.role = "them";
        it.text = text;
        it.tsUtc = "2026-11-18T10:00:00Z";
        it.precision = "second";
        return it;
    }

    @Test
    public void dedupesRepeatedMessagesPerContact() {
        CaptureQueue q = new CaptureQueue();
        assertTrue(q.addIfNew(item("Sam", "hi"), "k1"));
        assertFalse("re-posted notification", q.addIfNew(item("Sam", "hi"), "k1"));
        assertTrue("same key, other contact", q.addIfNew(item("Alex", "hi"), "k1"));
        assertEquals(2, q.size());
    }

    @Test
    public void drainDoesNotRemoveAckDoes() {
        CaptureQueue q = new CaptureQueue();
        CaptureQueue.Item a = item("Sam", "a"), b = item("Sam", "b"), c = item("Sam", "c");
        q.addIfNew(a, "a");
        q.addIfNew(b, "b");
        q.addIfNew(c, "c");
        List<CaptureQueue.Item> d = q.drain(2);
        assertEquals(2, d.size());
        assertEquals(3, q.size());
        assertEquals(2, q.ack(Arrays.asList(a.id, b.id, "missing")));
        assertEquals(1, q.size());
        assertEquals("c", q.drain(10).get(0).text);
    }

    @Test
    public void removeContactPurgesQueueAndSeenKeys() {
        CaptureQueue q = new CaptureQueue();
        q.addIfNew(item("Sam", "a"), "a");
        q.addIfNew(item("Alex", "b"), "b");
        assertEquals(1, q.removeContact("notify", "whatsapp", " sam "));
        assertEquals(1, q.size());
        assertEquals(1, q.seenSize());
        assertTrue("forgotten, so it can be captured again after re-linking", q.addIfNew(item("Sam", "a"), "a"));
    }

    @Test
    public void capsQueueSizeDroppingOldest() {
        CaptureQueue q = new CaptureQueue();
        for (int i = 0; i < CaptureQueue.MAX_ITEMS + 5; i++) q.addIfNew(item("Sam", "m" + i), "m" + i);
        assertEquals(CaptureQueue.MAX_ITEMS, q.size());
        assertEquals("m5", q.drain(1).get(0).text);
        assertEquals(5, q.dropped);
        q.clear();
        assertEquals(0, q.size());
        assertEquals(0, q.seenSize());
        assertEquals(0, q.dropped);
    }

    @Test
    public void seenKeysAreHashedNotPlainText() {
        CaptureQueue q = new CaptureQueue();
        q.addIfNew(item("Sam", "a very private message"), "them|a very private message|2026-11-18|?");
        for (String k : q.seenEntries().keySet()) assertFalse(k.contains("private"));
    }
}
