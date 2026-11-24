package app.lovevectorspace.demo.capture;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Decides whether an accessibility snapshot is a LINKED ONE-TO-ONE chat, and if so which text
 * nodes are bubbles. Pure Java over a plain node tree copied from AccessibilityNodeInfo (password
 * and editable nodes arrive with text == null), so it can be unit-tested on synthetic trees.
 *
 * Rules (any doubt means no capture):
 * 1. A message input box (editable) must sit in the lower part of the screen.
 * 2. A message-list container (scrollable, tall) must exist; the chat title is anchored ABOVE it.
 * 3. Title: a known per-app title view id if present, else the text nodes above the list minus
 *    status lines ("online", "typing…"). There must be EXACTLY ONE candidate, and it must exactly
 *    match a contact linked for this app.
 * 4. Group chats are refused: a known sender-label view id, the title text repeated inside the list,
 *    or per-bubble sender labels (short "them" lines stacked on top of another "them" node that
 *    repeat, or name a linked contact) all mean "group or unsure", so nothing is captured.
 */
public final class ChatScreen {

    private ChatScreen() {}

    public static final class UiNode {
        public String viewId; // may be null
        public String className; // may be null
        public String text; // null for password/editable nodes (never read)
        public int left, top, right, bottom;
        public boolean editable, password, scrollable, visible = true;
        public final List<UiNode> children = new ArrayList<>();

        public UiNode() {}

        public UiNode(String text, int left, int top, int right, int bottom) {
            this.text = text;
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
        }

        public UiNode add(UiNode c) {
            children.add(c);
            return this;
        }

        int height() {
            return bottom - top;
        }
    }

    public static final class Result {
        public final ContactGate.Link link; // null = do not capture
        public final String reason;
        public final int listTop, footerTop;
        public final List<BubbleParser.Node> bubbles;

        Result(ContactGate.Link link, String reason, int listTop, int footerTop, List<BubbleParser.Node> bubbles) {
            this.link = link;
            this.reason = reason;
            this.listTop = listTop;
            this.footerTop = footerTop;
            this.bubbles = bubbles;
        }

        static Result no(String reason) {
            return new Result(null, reason, 0, 0, new ArrayList<BubbleParser.Node>());
        }
    }

    /** Best-known chat-title view ids per package. Fallback logic covers apps/versions not listed. */
    static final Map<String, Set<String>> TITLE_IDS = new HashMap<>();
    /** View ids that only appear for per-message sender names (group chats). */
    static final Set<String> SENDER_LABEL_IDS = new HashSet<>(
        Arrays.asList("com.whatsapp:id/name_in_group", "com.whatsapp.w4b:id/name_in_group")
    );

    static {
        TITLE_IDS.put("com.whatsapp", new HashSet<>(Arrays.asList("com.whatsapp:id/conversation_contact_name")));
        TITLE_IDS.put("com.whatsapp.w4b", new HashSet<>(Arrays.asList("com.whatsapp.w4b:id/conversation_contact_name")));
        TITLE_IDS.put("com.instagram.android", new HashSet<>(Arrays.asList("com.instagram.android:id/thread_title")));
        TITLE_IDS.put("com.google.android.apps.messaging", new HashSet<>(Arrays.asList(
            "com.google.android.apps.messaging:id/conversation_title", "com.google.android.apps.messaging:id/title")));
    }

    private static final Pattern STATUS = Pattern.compile(
        "^(online|offline|typing.*|recording.*|last seen.*|active( now| \\d+\\s?[mhd]( ago)?| today| yesterday)?.*|tap here for contact info|click here for contact info|\\d+ (members|participants)?)$",
        Pattern.CASE_INSENSITIVE
    );

    private static void flatten(UiNode n, List<UiNode> out) {
        out.add(n);
        for (UiNode c : n.children) flatten(c, out);
    }

    private static boolean hasText(UiNode n) {
        return n.visible && n.text != null && !n.editable && !n.password && !n.text.trim().isEmpty();
    }

    public static Result analyze(UiNode root, String pkg, ContactGate gate) {
        if (root == null) return Result.no("no window");
        int w = Math.max(1, root.right - root.left);
        int h = Math.max(1, root.bottom - root.top);
        List<UiNode> all = new ArrayList<>();
        flatten(root, all);

        // 1. Input box in the lower 40% of the screen.
        int footerTop = Integer.MAX_VALUE;
        for (UiNode n : all) if (n.editable && n.top >= root.top + h * 0.6) footerTop = Math.min(footerTop, n.top);
        if (footerTop == Integer.MAX_VALUE) return Result.no("no input box");

        // 2. Message list: the topmost tall scrollable container above the input box.
        UiNode list = null;
        for (UiNode n : all) {
            if (!n.scrollable || n.editable) continue;
            if (n.height() < h * 0.3 || n.top >= footerTop) continue;
            if (list == null || n.top < list.top) list = n;
        }
        if (list == null) return Result.no("no message list");
        int listTop = list.top;

        // 3. Title: exactly one candidate above the list.
        List<UiNode> cands = new ArrayList<>();
        Set<String> ids = TITLE_IDS.get(pkg);
        if (ids != null) {
            for (UiNode n : all) if (hasText(n) && n.viewId != null && ids.contains(n.viewId) && n.bottom <= listTop) cands.add(n);
        }
        if (cands.isEmpty()) {
            for (UiNode n : all) {
                if (!hasText(n) || n.bottom > listTop || n.top < root.top) continue;
                String t = n.text.trim();
                if (STATUS.matcher(t).matches() || TimeParser.parseTime(t) != null) continue;
                cands.add(n);
            }
        }
        if (cands.size() != 1) return Result.no(cands.isEmpty() ? "no title" : "ambiguous title");
        UiNode title = cands.get(0);
        ContactGate.Link link = gate.match(CaptureApps.A11Y, pkg, title.text);
        if (link == null) return Result.no("title not linked");

        // 4. Bubbles inside the list; refuse group chats.
        List<UiNode> inList = new ArrayList<>();
        for (UiNode n : all) {
            if (n.viewId != null && SENDER_LABEL_IDS.contains(n.viewId) && n.visible) return Result.no("group chat");
            if (hasText(n) && n.top >= listTop && n.bottom <= Math.min(list.bottom, footerTop)) inList.add(n);
        }
        String titleNorm = ContactGate.normName(title.text);
        for (UiNode n : inList) if (ContactGate.normName(n.text).equals(titleNorm)) return Result.no("title repeated in list");
        if (hasSenderLabels(inList, w, gate, pkg)) return Result.no("group chat");

        List<BubbleParser.Node> bubbles = new ArrayList<>();
        for (UiNode n : inList) bubbles.add(new BubbleParser.Node(n.text, n.left, n.top, n.right, n.bottom, false, false));
        return new Result(link, "ok", listTop, footerTop, bubbles);
    }

    /**
     * Sender labels: a short left-side ("them") line sitting right on top of another left-side node.
     * One such pair could be a two-part bubble, so we call it a group when a label text repeats,
     * two different labels appear, or a label names any contact linked for this app.
     */
    static boolean hasSenderLabels(List<UiNode> nodes, int w, ContactGate gate, String pkg) {
        Map<String, Integer> labels = new HashMap<>();
        for (UiNode a : nodes) {
            if (a.right - a.left <= 0 || a.text.trim().length() > 40) continue;
            boolean left = a.left < w - a.right;
            if (!left) continue;
            for (UiNode b : nodes) {
                if (b == a || !(b.left < w - b.right)) continue;
                int gap = b.top - a.bottom;
                if (gap >= 0 && gap <= Math.max(6, a.height() / 4) && Math.abs(b.left - a.left) <= w * 0.03) {
                    String k = ContactGate.normName(a.text);
                    labels.put(k, labels.containsKey(k) ? labels.get(k) + 1 : 1);
                    if (gate.match(CaptureApps.A11Y, pkg, a.text) != null) return true;
                    break;
                }
            }
        }
        if (labels.size() >= 2) return true;
        for (int c : labels.values()) if (c >= 2) return true;
        return false;
    }
}
