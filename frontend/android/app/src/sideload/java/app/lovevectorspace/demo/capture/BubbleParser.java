package app.lovevectorspace.demo.capture;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Parses the visible text nodes of a chat screen into bubbles and separators. Pure Java,
 * fed by LvsAccessibilityService with plain values copied from AccessibilityNodeInfo.
 *
 * - Password and editable nodes are dropped before anything else (never read).
 * - Nodes above the chat header or inside the input bar are dropped.
 * - Centred date/time text is a separator; other centred text is a system notice (dropped).
 * - A bare time right under/inside the previous bubble is that bubble's time.
 * - Every other text node is a bubble; side by its bounds: nearer the right edge = me.
 */
public final class BubbleParser {

    private BubbleParser() {}

    public static final class Node {
        public final String text;
        public final int left, top, right, bottom;
        public final boolean editable, password;

        public Node(String text, int left, int top, int right, int bottom, boolean editable, boolean password) {
            this.text = text;
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
            this.editable = editable;
            this.password = password;
        }
    }

    public static final class Item {
        public final boolean separator;
        public final String role; // "me" | "them" for bubbles
        public String text;
        public final TimeParser.Ymd date; // separators only, may be null
        public int hour = -1, minute = -1;
        final int top, bottom, left, right;

        Item(boolean separator, String role, String text, TimeParser.Ymd date, Node n) {
            this.separator = separator;
            this.role = role;
            this.text = text;
            this.date = date;
            this.top = n.top;
            this.bottom = n.bottom;
            this.left = n.left;
            this.right = n.right;
        }
    }

    public static String clean(String s) {
        if (s == null) return "";
        return s.replaceAll("(^|\\s)[✓✔]{1,2}(?=\\s|$)", " ").replaceAll("\\s+", " ").trim();
    }

    public static List<Item> parse(List<Node> nodes, int screenWidth, int headerBottom, int footerTop, TimeParser.Ymd today) {
        int w = Math.max(1, screenWidth);
        List<Node> keep = new ArrayList<>();
        for (Node n : nodes) {
            if (n.password || n.editable) continue; // never read
            if (n.top < headerBottom || n.bottom > footerTop) continue;
            if (n.right <= n.left || n.bottom <= n.top) continue;
            if (clean(n.text).isEmpty()) continue;
            keep.add(n);
        }
        Collections.sort(keep, (a, b) -> a.top != b.top ? Integer.compare(a.top, b.top) : Integer.compare(a.left, b.left));

        List<Item> out = new ArrayList<>();
        for (Node n : keep) {
            String text = clean(n.text);
            int h = n.bottom - n.top;
            int[] t = TimeParser.parseTime(text);
            Item prev = out.isEmpty() ? null : out.get(out.size() - 1);
            if (t != null && prev != null && !prev.separator && n.top <= prev.bottom + h / 2 + 8 && n.bottom >= prev.top
                && n.left < prev.right + w / 20 && n.right > prev.left - w / 20) {
                prev.hour = t[0];
                prev.minute = t[1];
                continue;
            }
            int cx = (n.left + n.right) / 2;
            boolean centred = Math.abs(cx - w / 2) < w * 0.06 && (n.right - n.left) < w * 0.6;
            if (centred) {
                TimeParser.Parsed sep = TimeParser.parseSeparator(text, today);
                if (sep != null) {
                    Item s = new Item(true, null, text, sep.date, n);
                    s.hour = sep.hour;
                    s.minute = sep.minute;
                    out.add(s);
                }
                continue; // system notice otherwise
            }
            if (t != null) continue; // stray time we can't place
            int leftGap = n.left, rightGap = w - n.right;
            String role = leftGap > rightGap ? "me" : "them";
            Item b = new Item(false, role, text, null, n);
            Object[] split = TimeParser.splitTrailingTime(text);
            if (split != null) {
                b.text = (String) split[0];
                int[] tt = (int[]) split[1];
                b.hour = tt[0];
                b.minute = tt[1];
            }
            out.add(b);
        }
        return out;
    }
}
