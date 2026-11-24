package app.lovevectorspace.demo.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class BubbleParserTest {

    private static final int W = 1080;
    // Wednesday 2026-11-18
    private static final TimeParser.Ymd TODAY = new TimeParser.Ymd(2026, 11, 18);

    private static BubbleParser.Node them(String t, int top) {
        return new BubbleParser.Node(t, 60, top, 60 + t.length() * 22, top + 48, false, false);
    }

    private static BubbleParser.Node me(String t, int top) {
        return new BubbleParser.Node(t, W - 60 - t.length() * 22, top, W - 60, top + 48, false, false);
    }

    private static BubbleParser.Node centred(String t, int top) {
        int w = t.length() * 20;
        return new BubbleParser.Node(t, (W - w) / 2, top, (W + w) / 2, top + 36, false, false);
    }

    private static BubbleParser.Node time(String t, BubbleParser.Node bubble) {
        return new BubbleParser.Node(t, bubble.right - 120, bubble.bottom + 2, bubble.right - 10, bubble.bottom + 30, false, false);
    }

    private List<BubbleParser.Item> screen() {
        BubbleParser.Node b1 = them("did you get home ok", 400);
        BubbleParser.Node b2 = me("yes thanks for tonight", 520);
        List<BubbleParser.Node> nodes = new ArrayList<>(Arrays.asList(
            new BubbleParser.Node("Alex", 160, 80, 300, 130, false, false), // title in header
            centred("Yesterday", 300),
            b1, time("11:02 PM", b1),
            b2, time("11:05 PM", b2),
            centred("You reacted ❤️", 640), // centred system notice
            them("same time next week? 11:07 PM", 720),
            new BubbleParser.Node("secret", 60, 900, 400, 948, false, true), // password field
            new BubbleParser.Node("draft reply", 60, 2200, 900, 2260, true, false) // compose box
        ));
        return BubbleParser.parse(nodes, W, 200, 2150, TODAY);
    }

    @Test
    public void parsesSidesSeparatorsAndTimes() {
        List<BubbleParser.Item> items = screen();
        assertEquals(4, items.size());
        assertTrue(items.get(0).separator);
        assertEquals(new TimeParser.Ymd(2026, 11, 17), items.get(0).date);
        assertEquals("them", items.get(1).role);
        assertEquals("did you get home ok", items.get(1).text);
        assertEquals(23, items.get(1).hour);
        assertEquals(2, items.get(1).minute);
        assertEquals("me", items.get(2).role);
        assertEquals(5, items.get(2).minute);
        assertEquals("same time next week?", items.get(3).text);
        assertEquals(7, items.get(3).minute);
    }

    @Test
    public void neverReadsPasswordOrEditableNodesOrTheHeader() {
        for (BubbleParser.Item it : screen()) {
            assertTrue(!it.text.contains("secret") && !it.text.contains("draft") && !it.text.equals("Alex"));
        }
        // Even inside the chat area and with no header/footer limits.
        List<BubbleParser.Node> only = Arrays.asList(
            new BubbleParser.Node("hunter2", 60, 500, 300, 548, false, true),
            new BubbleParser.Node("typing this", W - 400, 600, W - 60, 648, true, false)
        );
        assertTrue(BubbleParser.parse(only, W, 0, 10000, TODAY).isEmpty());
    }

    @Test
    public void assignsTimestampsWithPrecision() {
        List<TimeAssigner.Msg> msgs = TimeAssigner.assign(screen(), TODAY, 15, 0);
        assertEquals(3, msgs.size());
        assertEquals("2026-11-17T23:02:00", msgs.get(0).tsLocal);
        assertEquals("minute", msgs.get(0).precision);
        assertEquals("2026-11-17T23:05:00", msgs.get(1).tsLocal);
        assertEquals("2026-11-17T23:07:00", msgs.get(2).tsLocal);
        assertEquals("them|did you get home ok|2026-11-17|23:02", msgs.get(0).dedupeKey);
    }

    @Test
    public void unlabelledBubblesOnTodaysScreenAreJustNowAndOrdered() {
        List<BubbleParser.Node> nodes = Arrays.asList(them("hey", 400), me("hi!", 500), them("how are you", 600));
        List<TimeAssigner.Msg> msgs = TimeAssigner.assign(BubbleParser.parse(nodes, W, 0, 3000, TODAY), TODAY, 15, 0);
        assertEquals("2026-11-18T14:59:57", msgs.get(0).tsLocal);
        assertEquals("2026-11-18T14:59:59", msgs.get(2).tsLocal);
        assertEquals("approx", msgs.get(0).precision);
    }

    @Test
    public void timeParserBasics() {
        assertEquals(22, TimeParser.parseTime("10:42 PM")[0]);
        assertEquals(0, TimeParser.parseTime("12:05 am")[0]);
        assertNull(TimeParser.parseTime("25:00"));
        assertEquals(new TimeParser.Ymd(2026, 11, 16), TimeParser.parseSeparator("Monday", TODAY).date);
        assertEquals(new TimeParser.Ymd(2026, 11, 11), TimeParser.parseSeparator("Wednesday", TODAY).date);
        assertEquals(new TimeParser.Ymd(2025, 12, 24), TimeParser.parseSeparator("Dec 24", TODAY).date);
        TimeParser.Parsed p = TimeParser.parseSeparator("Yesterday at 9:01 AM", TODAY);
        assertNotNull(p);
        assertEquals(new TimeParser.Ymd(2026, 11, 17), p.date);
        assertEquals(9, p.hour);
        assertNull(TimeParser.parseSeparator("Monday works", TODAY));
        assertNull(TimeParser.parseSeparator("Feb 30", TODAY));
    }
}
