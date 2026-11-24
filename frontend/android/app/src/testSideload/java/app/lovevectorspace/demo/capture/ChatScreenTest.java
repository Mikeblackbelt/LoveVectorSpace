package app.lovevectorspace.demo.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import java.util.Arrays;
import org.junit.Test;

public class ChatScreenTest {

    private static final int W = 1080, H = 2400;
    private static final String WA = "com.whatsapp", IG = "com.instagram.android", HINGE = "co.hinge.app";

    private final ContactGate gate = new ContactGate(Arrays.asList(
        new ContactGate.Link("a11y", "whatsapp", "Sam", 1),
        new ContactGate.Link("a11y", "hinge", "Sam", 1),
        new ContactGate.Link("a11y", "instagram", "sam_r", 1)
    ));

    private static ChatScreen.UiNode text(String t, int l, int top, int r, int b) {
        return new ChatScreen.UiNode(t, l, top, r, b);
    }

    private static ChatScreen.UiNode them(String t, int top) {
        return text(t, 60, top, 60 + Math.max(60, t.length() * 22), top + 48);
    }

    private static ChatScreen.UiNode me(String t, int top) {
        return text(t, W - 60 - Math.max(60, t.length() * 22), top, W - 60, top + 48);
    }

    private static ChatScreen.UiNode list(ChatScreen.UiNode... kids) {
        ChatScreen.UiNode l = new ChatScreen.UiNode(null, 0, 300, W, 2150);
        l.scrollable = true;
        l.className = "androidx.recyclerview.widget.RecyclerView";
        for (ChatScreen.UiNode k : kids) l.add(k);
        return l;
    }

    private static ChatScreen.UiNode compose() {
        ChatScreen.UiNode c = new ChatScreen.UiNode(null, 40, 2200, 900, 2300); // text never copied
        c.editable = true;
        return c;
    }

    private static ChatScreen.UiNode screen(ChatScreen.UiNode... kids) {
        ChatScreen.UiNode root = new ChatScreen.UiNode(null, 0, 0, W, H);
        for (ChatScreen.UiNode k : kids) root.add(k);
        return root;
    }

    @Test
    public void linkedOneToOneChatIsCaptured() {
        ChatScreen.Result r = ChatScreen.analyze(screen(
            text("Sam", 200, 100, 320, 160), text("online", 200, 165, 320, 200),
            list(them("hey are you around", 400), me("yes!", 520)), compose()), HINGE, gate);
        assertNotNull(r.link);
        assertEquals(1, r.link.pid);
        assertEquals(2, r.bubbles.size());
        assertEquals(300, r.listTop);
    }

    @Test
    public void groupChatWithLinkedSenderLabelIsNotCaptured() {
        // Group "Weekend crew" where linked contact Sam posts: the label "Sam" sits on top of the bubble.
        ChatScreen.UiNode label = text("Sam", 60, 400, 160, 436);
        ChatScreen.UiNode msg = text("are we still on?", 60, 440, 420, 488);
        ChatScreen.Result r = ChatScreen.analyze(screen(
            text("Weekend crew", 200, 100, 500, 160), list(label, msg), compose()), WA, gate);
        assertNull(r.link);
        // Even if the group is NAMED like a linked contact, per-bubble sender labels refuse it.
        r = ChatScreen.analyze(screen(
            text("Sam", 200, 100, 320, 160),
            list(text("Alex", 60, 400, 160, 436), text("hi all", 60, 440, 260, 488),
                text("Jo", 60, 600, 140, 636), text("hello", 60, 640, 240, 688)), compose()), HINGE, gate);
        assertNull(r.link);
        assertEquals("group chat", r.reason);
    }

    @Test
    public void whatsAppSenderLabelViewIdMeansGroup() {
        ChatScreen.UiNode title = text("Sam", 200, 100, 320, 160);
        title.viewId = "com.whatsapp:id/conversation_contact_name";
        ChatScreen.UiNode label = text("Alex", 60, 400, 160, 436);
        label.viewId = "com.whatsapp:id/name_in_group";
        ChatScreen.Result r = ChatScreen.analyze(screen(title, list(label, them("hi", 440)), compose()), WA, gate);
        assertNull(r.link);
    }

    @Test
    public void unlinkedChatWithASamBubbleIsNotCaptured() {
        ChatScreen.Result r = ChatScreen.analyze(screen(
            text("Jordan", 200, 100, 380, 160), list(them("Sam", 320), me("what about Sam?", 420)), compose()), HINGE, gate);
        assertNull(r.link);
        assertEquals("title not linked", r.reason);
    }

    @Test
    public void instagramCommentsScreenIsNotCaptured() {
        // Comments sheet: "Comments" header, linked user's comment in the list, comment box at the bottom.
        ChatScreen.Result r = ChatScreen.analyze(screen(
            text("Comments", 420, 100, 660, 160),
            list(text("sam_r", 60, 400, 200, 436), text("love this!", 60, 440, 300, 488)), compose()), IG, gate);
        assertNull(r.link);
        // Variant without a header title: post author + caption above the list -> ambiguous.
        r = ChatScreen.analyze(screen(
            text("sam_r", 60, 100, 200, 140), text("sunset at the lake", 60, 150, 500, 200),
            list(text("nice", 60, 400, 200, 448)), compose()), IG, gate);
        assertNull(r.link);
        assertEquals("ambiguous title", r.reason);
    }

    @Test
    public void knownTitleIdWinsOverOtherHeaderText() {
        ChatScreen.UiNode title = text("Sam", 200, 100, 320, 160);
        title.viewId = "com.whatsapp:id/conversation_contact_name";
        ChatScreen.Result r = ChatScreen.analyze(screen(
            title, text("Encrypted", 600, 100, 800, 160), list(them("hey", 400)), compose()), WA, gate);
        assertNotNull(r.link);
    }

    @Test
    public void refusesWithoutInputBoxOrMessageList() {
        assertEquals("no input box", ChatScreen.analyze(screen(text("Sam", 200, 100, 320, 160), list(them("hey", 400))), HINGE, gate).reason);
        assertEquals("no message list", ChatScreen.analyze(screen(text("Sam", 200, 100, 320, 160), them("hey", 400), compose()), HINGE, gate).reason);
        assertEquals("ambiguous title", ChatScreen.analyze(screen(
            text("Sam", 200, 100, 320, 160), text("Profile", 700, 100, 900, 160), list(them("hey", 400)), compose()), HINGE, gate).reason);
    }

    @Test
    public void contactNameInsideTheListMeansUnsure() {
        ChatScreen.Result r = ChatScreen.analyze(screen(
            text("Sam", 200, 100, 320, 160), list(them("Sam", 400), them("hello", 520)), compose()), HINGE, gate);
        assertNull(r.link);
    }
}
